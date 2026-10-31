import { act, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { ComponentProjectAdministration } from './ComponentProjectAdministration';

vi.setConfig({ testTimeout: 30000 });
const originalAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => configure({ asyncUtilTimeout: 5000 }));
afterAll(() => configure({ asyncUtilTimeout: originalAsyncTimeout }));

type Project = components['schemas']['ComponentProjectRecordDto'];
type Mapping = components['schemas']['ComponentProjectMappingListItemDto'];
type Summary = components['schemas']['ComponentProjectSummaryDto'];
type CreateProject = components['schemas']['CreateComponentProjectRecordDto'];
type CreateMapping = components['schemas']['CreateComponentProjectMappingDto'];
type Assignment = components['schemas']['ComponentEngineerAssignmentDto'];
type BulkPreview = components['schemas']['ComponentProjectBulkPreviewResultDto'];
const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['component-project:read', 'component-project:manage'] };
const audit = { id: 'project-a', organizationId: organization.id, version: 7, status: 'ACTIVE' as const, createdByUserId: 'creator', updatedByUserId: 'creator', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' };
const project: Project = { ...audit, code: 'P001', name: '电驱项目', stage: 'NEW_PRODUCT', customerEngineerAssignmentId: null, projectEngineerAssignmentId: null };
const unconfigured: Assignment = { assignmentId: null, userId: null, username: null, fullName: null, positionId: null, positionName: null, departmentId: null, departmentName: null, valid: false, issues: ['ENGINEER_NOT_CONFIGURED'] };
const summary: Summary = { id: project.id, code: project.code, name: project.name, stage: project.stage, status: project.status, customerEngineer: unconfigured, projectEngineer: unconfigured };
const mapping: Mapping = { ...audit, id: 'mapping-a', componentCode: 'COMP-001', componentName: '驱动总成', projectRecordId: project.id, productCategory: '电驱', productSubcategory: null, project: summary };
const engineer: Assignment = { assignmentId: 'assignment-a', userId: 'user-a', username: 'zhangsan', fullName: '张三', positionId: 'position-a', positionName: '质量工程师', departmentId: 'department-a', departmentName: '项目质量室', valid: true, issues: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-a'); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); useWorkTabsStore.getState().reset(); });

function server(options: { projects?: Project[]; mappings?: Mapping[]; failure?: number; intercept?: (url: URL, init: RequestInit) => Promise<Response> | undefined } = {}) {
  const writes: Array<{ url: URL; init: RequestInit; body: Record<string, unknown> }> = [];
  const reads: URL[] = [];
  const projects = [...(options.projects ?? [project])];
  const mappings = [...(options.mappings ?? [mapping])];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    if ((!init.method || init.method === 'GET') && !url.pathname.endsWith('/csrf')) reads.push(url);
    const intercepted = options.intercept?.(url, init);
    if (intercepted) return intercepted;
    if (url.pathname.endsWith('/csrf')) return json({ csrfToken: 'token' });
    if (init.method && init.method !== 'GET') {
      const body = JSON.parse(String(init.body)); writes.push({ url, init, body });
      if (options.failure) return json({ code: options.failure === 409 ? 'CONCURRENCY_CONFLICT' : 'VALIDATION_FAILED', fields: {}, traceId: 'mapping-test' }, options.failure);
      if (url.pathname.includes('/component-project-records')) {
        const input: CreateProject = body;
        const result: Project = { ...project, ...input, id: init.method === 'PATCH' ? project.id : 'created', version: 8 };
        projects.splice(0, projects.length, result);
        return json(result);
      }
      const input: CreateMapping = body;
      const result: Mapping = { ...(mappings.find(item => item.id === mapping.id) ?? mapping), ...input, id: init.method === 'PATCH' ? mapping.id : 'created', version: 8 };
      mappings.splice(0, mappings.length, result);
      return json(result);
    }
    if (url.pathname.endsWith('/engineer-assignments')) return json({ items: [engineer], selected: url.searchParams.has('selectedAssignmentId') ? engineer : null, total: 1, page: 1, pageSize: 20 });
    if (url.pathname.endsWith('/component-project-records')) return json({ items: projects, total: projects.length, page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 20) });
    if (url.pathname.endsWith(`/component-project-records/${project.id}`)) return json(projects.find(item => item.id === project.id) ?? project);
    if (url.pathname.endsWith('/component-project-mappings')) return json({ items: mappings, total: mappings.length, page: 1, pageSize: 20 });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes, reads, fetchMock };
}
function workspace(org: AdminOrganization) {
  return <ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><UnsavedChangesProvider><Routes>
    <Route path="/" element={<ComponentProjectAdministration organization={org} />} />
    <Route path="/login" element={<h1>登录页</h1>} />
  </Routes></UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>;
}
function mount(org = organization) { return render(workspace(org)); }
function componentToolbar() {
  const panel = screen.getByRole('region', { name: '组件项目映射' });
  return within(panel.querySelector<HTMLElement>('.governance-toolbar')!);
}
async function openProject() {
  fireEvent.click(await componentToolbar().findByRole('button', { name: '项目资料' }));
  const projects = await screen.findByRole('dialog', { name: '项目资料' });
  fireEvent.click(await within(projects).findByRole('button', { name: '新增项目' }));
  return screen.findByRole('dialog', { name: '项目资料' });
}
async function confirmationButton(name: string) {
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  const dialog = title.closest<HTMLElement>('[role="dialog"]')!;
  const button = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(button).toBeVisible());
  return button;
}
async function choose(label: string, text: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: text }));
}
function submit(dialog: HTMLElement) { fireEvent.submit(dialog.querySelector('form')!); }

it('offers mapping columns without remounting an unsaved component editor', async () => {
  server(); mount();
  await screen.findByText('驱动总成');
  await userEvent.click(screen.getByRole('button', { name: '新增组件' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('组件编码'), { target: { value: 'KEEP-COMPONENT' } });
  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  expect(within(dialog).getByLabelText('组件编码')).toHaveValue('KEEP-COMPONENT');
});

it('requires an explicit project stage and creates a project with nullable engineers using the platform mutation', async () => {
  const { writes } = server({ projects: [] }); mount();
  await screen.findByText('驱动总成');
  expect(screen.queryByText('修改将影响同项目的全部组件。')).not.toBeInTheDocument();
  const dialog = await openProject();
  expect(within(dialog).queryByText('修改将影响同项目的全部组件。')).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('项目编码'), { target: { value: 'P002' } });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '新项目' } });
  submit(dialog);
  await screen.findByText('请选择项目阶段');
  expect(writes).toHaveLength(0);
  await choose('项目阶段', '新品');
  submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ code: 'P002', name: '新项目', stage: 'NEW_PRODUCT', customerEngineerAssignmentId: null, projectEngineerAssignmentId: null, status: 'ACTIVE' });
  expect(writes[0].url.searchParams.get('organizationId')).toBe(organization.id);
  expect(writes[0].init.headers).toMatchObject({ 'x-csrf-token': 'token', 'Idempotency-Key': expect.any(String) });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('edits stage only in the shared project and sends its expected version', async () => {
  const { writes } = server(); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  expect(await within(dialog).findByText('修改将影响同项目的全部组件。')).toBeInTheDocument();
  await choose('项目阶段', '量产'); submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].init.method).toBe('PATCH');
  expect(writes[0].url.pathname).toMatch(/component-project-records\/project-a$/);
  expect(writes[0].body).toMatchObject({ stage: 'MASS_PRODUCTION', expectedVersion: 7 });
});

it.each([409, 422, 503])('keeps the project draft and stable retry identity after HTTP %s', async failure => {
  const { writes } = server({ failure }); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  const input = within(dialog).getByLabelText('项目名称');
  fireEvent.change(input, { target: { value: '保留的名称' } }); submit(dialog);
  await within(dialog).findAllByRole('alert');
  expect(input).toHaveValue('保留的名称');
  if (failure >= 500) fireEvent.click(within(dialog).getByRole('button', { name: '重试原请求' })); else submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].body).toEqual(writes[0].body);
  expect(writes[1].init.headers).toEqual(writes[0].init.headers);
});

it('uses async named appointments, preserves selected identities and allows clearing', async () => {
  const { writes, reads } = server({ projects: [{ ...project, customerEngineerAssignmentId: engineer.assignmentId }] }); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  await within(dialog).findByText('张三（zhangsan） · 质量工程师 / 项目质量室');
  expect(reads.some(url => url.searchParams.get('selectedAssignmentId') === engineer.assignmentId)).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: '清空客户质量工程师' }));
  submit(dialog);
  await waitFor(() => expect(writes[0]?.body.customerEngineerAssignmentId).toBeNull());
  expect(within(dialog).queryByRole('textbox', { name: /UUID/ })).not.toBeInTheDocument();
});

it('does not grant maintenance through configuration permission and never reads without mapping read permission', async () => {
  const { fetchMock } = server();
  const view = mount({ ...organization, permissions: ['component-project:read', 'configuration:manage'] });
  await screen.findByText('P001 · 电驱项目');
  expect(screen.queryByRole('button', { name: '新增项目' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '编辑项目 P001' })).not.toBeInTheDocument();
  view.unmount(); fetchMock.mockClear();
  mount({ ...organization, permissions: ['component-project:manage'] });
  expect(await screen.findByText('无组件项目映射读取权限')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('ignores late list responses after organization, session or permission scope changes', async () => {
  const late = deferred<Response>();
  server({ intercept: url => url.searchParams.get('organizationId') === 'org-a' && url.pathname.endsWith('/component-project-mappings') ? late.promise : undefined });
  const view = render(<MemoryRouter><LanguageProvider><ComponentProjectAdministration organization={organization} /></LanguageProvider></MemoryRouter>);
  view.rerender(<MemoryRouter><LanguageProvider><ComponentProjectAdministration organization={{ ...organization, id: 'org-b', permissions: [] }} /></LanguageProvider></MemoryRouter>);
  await act(async () => late.resolve(json({ items: [mapping], total: 1, page: 1, pageSize: 20 })));
  expect(screen.queryByText('驱动总成')).not.toBeInTheDocument();
  expect(screen.getByText('无组件项目映射读取权限')).toBeInTheDocument();
});

it('protects cancel until explicit discard', async () => {
  server(); mount(); const dialog = await openProject();
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '未保存' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭编辑器' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(within(dialog).getByLabelText('项目名称')).toHaveValue('未保存');
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭编辑器' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('protects a refresh and completes only the confirmed discard in the single-table workspace', async () => {
  server(); mount(); const dialog = await openProject();
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '未保存' } });
  fireEvent.click(componentToolbar().getByRole('button', { name: /^刷\s*新$/ }));
  fireEvent.click(await confirmationButton('继续编辑'));
  expect(within(dialog).getByLabelText('项目名称')).toHaveValue('未保存');
  fireEvent.click(componentToolbar().getByRole('button', { name: /^刷\s*新$/ }));
  fireEvent.click(await confirmationButton('放弃修改'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getAllByRole('table')).toHaveLength(1);
});

it('creates a component mapping through paged named project options without copying the project stage', async () => {
  const { writes, reads } = server(); mount();
  fireEvent.click(await screen.findByRole('button', { name: '新增组件' }));
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  fireEvent.change(within(dialog).getByLabelText('组件编码'), { target: { value: 'COMP-001' } });
  fireEvent.change(within(dialog).getByLabelText('组件名称'), { target: { value: '新组件' } });
  fireEvent.change(within(dialog).getByLabelText('产品大类'), { target: { value: '电驱' } });
  await choose('关联项目', 'P001 · 电驱项目 · 新品');
  expect(within(dialog).queryByLabelText('项目阶段')).not.toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: /^保\s*存$/ })).toBeEnabled());
  submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ componentCode: 'COMP-001', componentName: '新组件', projectRecordId: project.id, productCategory: '电驱', productSubcategory: null, status: 'ACTIVE' });
  expect(reads.some(url => url.pathname.endsWith('/component-project-records') && url.searchParams.has('page') && url.searchParams.has('pageSize'))).toBe(true);
});

it('freezes inputs during a write and does not run an old completion after session replacement', async () => {
  const late = deferred<Response>();
  const { fetchMock } = server({ intercept: (_url, init) => init.method === 'PATCH' ? late.promise : undefined });
  mount(); fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '在途输入' } }); submit(dialog);
  await waitFor(() => expect(within(dialog).getByLabelText('项目名称')).toBeDisabled());
  expect(within(dialog).getByRole('button', { name: '关闭编辑器' })).toBeDisabled();
  submit(dialog);
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-b'));
  const callsBefore = fetchMock.mock.calls.length;
  await act(async () => late.resolve(json({ ...project, name: '旧会话结果', version: 8 })));
  expect(screen.queryByText('旧会话结果')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.slice(callsBefore).some(([, init]) => init?.method === 'PATCH')).toBe(false);
});

it('clears the full workspace and draft on a current 401 without a discard prompt', async () => {
  server({ intercept: (url, init) => init.method === 'PATCH' && url.pathname.includes('component-project-records') ? Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)) : undefined });
  mount(); fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }, { timeout: 5000 }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '未保存' } }); submit(dialog);
  await screen.findByRole('heading', { name: '登录页' });
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('renders joined project summaries without per-row requests and restores a selected project outside the option page', async () => {
  const { reads, writes } = server({ projects: [], mappings: [mapping, { ...mapping, id: 'mapping-b', componentCode: 'COMP-002' }] }); mount();
  await screen.findByRole('button', { name: '编辑组件 COMP-001' });
  expect(screen.getAllByText('P001 · 电驱项目')).toHaveLength(2);
  expect(reads.filter(url => url.pathname.endsWith(`/component-project-records/${project.id}`))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '编辑组件 COMP-001' }));
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  await waitFor(() => expect(reads.filter(url => url.pathname.endsWith(`/component-project-records/${project.id}`))).toHaveLength(1));
  await within(dialog).findByText('P001 · 电驱项目 · 新品');
  fireEvent.change(within(dialog).getByLabelText('产品细分'), { target: { value: '驱动总成' } }); submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ productSubcategory: '驱动总成', expectedVersion: mapping.version });
  expect(writes[0].body).not.toHaveProperty('stage');
  expect(writes[0].body).not.toHaveProperty('customerEngineerAssignmentId');
});

it('retains a missing selected project with a readable error instead of silently clearing or showing its UUID', async () => {
  const { writes } = server({ mappings: [mapping], intercept: url => url.pathname.endsWith(`/component-project-records/${project.id}`) ? Promise.resolve(json({ code: 'NOT_FOUND' }, 404)) : undefined }); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑组件 COMP-001' }));
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  await within(dialog).findByText('已选项目不可用，请重试或重新选择');
  expect(within(dialog).queryByText(project.id)).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText('关联项目')).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it('shows invalid appointments without dropping the selection and permits explicit clearing', async () => {
  const invalid = { ...engineer, valid: false, issues: ['ASSIGNMENT_ENDED'] };
  const { writes } = server({ projects: [{ ...project, customerEngineerAssignmentId: engineer.assignmentId }], intercept: url => url.pathname.endsWith('/engineer-assignments') ? Promise.resolve(json({ items: [], selected: url.searchParams.has('selectedAssignmentId') ? invalid : null, total: 0, page: 1, pageSize: 20 })) : undefined }); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  await within(dialog).findByText('已选任职失效，请重新选择或清空');
  fireEvent.click(within(dialog).getByRole('button', { name: '清空客户质量工程师' }));
  submit(dialog);
  await waitFor(() => expect(writes[0]?.body.customerEngineerAssignmentId).toBeNull());
});

it('reports candidate API failure with a retry and keeps the project draft', async () => {
  let fail = true;
  server({ intercept: url => url.pathname.endsWith('/engineer-assignments') && fail ? Promise.resolve(json({ code: 'HTTP_503' }, 503)) : undefined }); mount();
  const dialog = await openProject();
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '保留草稿' } });
  await within(dialog).findAllByRole('alert'); fail = false;
  fireEvent.click(within(dialog).getAllByRole('button', { name: /^重\s*试$/ })[0]);
  await choose('客户质量工程师', '张三（zhangsan） · 质量工程师 / 项目质量室');
  expect(within(dialog).getByLabelText('项目名称')).toHaveValue('保留草稿');
});

it('uses server search and pagination instead of filtering one downloaded page', async () => {
  const { reads } = server({ intercept: url => url.pathname.endsWith('/component-project-mappings') ? Promise.resolve(json({ items: [mapping], page: Number(url.searchParams.get('page') ?? 1), pageSize: 20, total: 45 })) : undefined }); mount();
  await screen.findByText('驱动总成');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: 'COMP' } });
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索组件' }), { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(reads.some(url => url.searchParams.get('search') === 'COMP' && url.searchParams.get('page') === '1')).toBe(true));
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(reads.some(url => url.searchParams.get('search') === 'COMP' && url.searchParams.get('page') === '2')).toBe(true));
});

it('retries an unknown write with the unchanged payload and key rather than allowing a new write', async () => {
  let fail = true;
  const attempts: RequestInit[] = [];
  server({ intercept: (_url, init) => {
    if (init.method !== 'PATCH') return undefined;
    attempts.push(init);
    return fail ? Promise.reject(new TypeError('network')) : Promise.resolve(json({ ...project, version: 8 }));
  } }); mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '结果未知' } }); submit(dialog);
  await within(dialog).findByText('保存结果尚未确认，请使用原请求重试。');
  expect(within(dialog).getByLabelText('项目名称')).toBeDisabled();
  fail = false;
  fireEvent.click(within(dialog).getByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(attempts[1].headers).toEqual(attempts[0].headers);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('has one component table and permits editing imported name/status without completing the mapping', async () => {
  const incomplete: Mapping = { ...mapping, projectRecordId: null, project: null, productCategory: null };
  const { writes } = server({ mappings: [incomplete] }); mount();
  await screen.findByText('驱动总成');
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  const indicator = screen.getByRole('button', { name: '未映射' });
  fireEvent.click(indicator);
  await screen.findByRole('tooltip');
  fireEvent.click(screen.getByRole('button', { name: '编辑组件 COMP-001' }));
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  fireEvent.change(within(dialog).getByLabelText('组件名称'), { target: { value: '补充名称' } }); submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ componentName: '补充名称', expectedVersion: mapping.version });
  expect(writes[0].body).not.toHaveProperty('projectRecordId');
  expect(writes[0].body).not.toHaveProperty('productCategory');
});

it('keeps selected component identities across pages and clears them on organization change', async () => {
  server({ intercept: url => url.pathname.endsWith('/component-project-mappings') ? Promise.resolve(json({ items: [{ ...mapping, id: `mapping-${url.searchParams.get('page') ?? '1'}`, componentCode: `COMP-${url.searchParams.get('page') ?? '1'}` }], total: 45, page: Number(url.searchParams.get('page') ?? 1), pageSize: 20 })) : undefined });
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><ComponentProjectAdministration organization={organization} /></MemoryRouter></LanguageProvider></ConfigProvider>);
  await screen.findByText('COMP-1');
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  await screen.findByText('已选择 1 / 100');
  fireEvent.click(screen.getByTitle('2'));
  await screen.findByText('COMP-2');
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  await screen.findByText('已选择 2 / 100');
  view.rerender(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><ComponentProjectAdministration organization={{ ...organization, id: 'org-b' }} /></MemoryRouter></LanguageProvider></ConfigProvider>);
  await screen.findByText('已选择 0 / 100');
});

it('protects keyboard Escape and restores focus to the new-component trigger after discard', async () => {
  server(); mount();
  const trigger = await screen.findByRole('button', { name: '新增组件' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  const input = within(dialog).getByLabelText('组件编码');
  fireEvent.change(input, { target: { value: 'KEYBOARD-DRAFT' } }); input.focus();
  await userEvent.keyboard('{Escape}');
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(input).toHaveValue('KEYBOARD-DRAFT');
  input.focus(); await userEvent.keyboard('{Escape}');
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

const bulkPreview: BulkPreview = { selectedCount: 1, affectedMappingsCount: 5, previewToken: 'a'.repeat(64), affectedProjects: [{ id: project.id, code: project.code, name: project.name, stage: project.stage, status: 'ACTIVE', version: project.version, selectedComponentCount: 1, totalComponentCount: 5, otherComponentCount: 4 }] };
async function openBulk() {
  await screen.findByText('驱动总成'); fireEvent.click(screen.getAllByRole('checkbox')[1]);
  fireEvent.click(screen.getByRole('button', { name: '批量设置' }));
  return screen.findByRole('dialog', { name: '批量设置' });
}
function bulkServer(applyStatus = 200) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  server({ intercept: (url, init) => {
    if (!url.pathname.endsWith('/bulk-preview') && !url.pathname.endsWith('/bulk-apply')) return undefined;
    requests.push({ url, init });
    return Promise.resolve(url.pathname.endsWith('/bulk-preview') ? json(bulkPreview) : applyStatus === 200
      ? json({ updatedMappingCount: 1, updatedProjectCount: 1, affectedComponentCount: 5 })
      : json({ code: 'CONCURRENCY_CONFLICT' }, applyStatus));
  } });
  return requests;
}

it('previews shared project impact and applies only explicitly enabled fields after confirmation', async () => {
  const requests = bulkServer(); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await within(dialog).findByText('同项目另有 4 条未选组件');
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ selection: [{ id: mapping.id, expectedVersion: mapping.version }], changes: { stage: 'MASS_PRODUCTION' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认应用' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].url.searchParams.get('organizationId')).toBe(organization.id);
  expect(JSON.parse(String(requests[1].init.body))).toEqual({ selection: [{ id: mapping.id, expectedVersion: mapping.version }], changes: { stage: 'MASS_PRODUCTION' }, previewToken: bulkPreview.previewToken });
  await screen.findByText('已更新 1 条组件资料、1 个项目；影响 5 条组件。');
});

it('invalidates the preview token when changes are edited and does not treat blank engineers as clearing', async () => {
  const requests = bulkServer(); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await within(dialog).findByRole('button', { name: '确认应用' });
  await choose('项目阶段', '新品');
  expect(within(dialog).queryByRole('button', { name: '确认应用' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(JSON.parse(String(requests[1].init.body)).changes).toEqual({ stage: 'NEW_PRODUCT' });
});

it('preserves the bulk draft and selection on a 409 but requires a fresh preview before apply', async () => {
  const requests = bulkServer(409); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '确认应用' }));
  await within(dialog).findAllByRole('alert');
  expect(within(dialog).queryByRole('button', { name: '确认应用' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '设置项目阶段' })).toBeChecked();
  expect(screen.getByText('已选择 1 / 100')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(JSON.parse(String(requests[2].init.body)).changes).toEqual({ stage: 'MASS_PRODUCTION' });
});

it('sends null only for explicitly enabled and explicitly cleared engineer fields', async () => {
  const requests = bulkServer(); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await within(dialog).findByText('请至少选择一个批量字段'); expect(requests).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置客户质量工程师' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '清空客户质量工程师' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(JSON.parse(String(requests[0].init.body)).changes).toEqual({ customerEngineerAssignmentId: null });
});

it('retries an unknown bulk apply with its original token, body and idempotency key', async () => {
  let failed = false; const attempts: RequestInit[] = [];
  server({ intercept: (url, init) => {
    if (url.pathname.endsWith('/bulk-preview')) return Promise.resolve(json(bulkPreview));
    if (!url.pathname.endsWith('/bulk-apply')) return undefined;
    attempts.push(init);
    if (!failed) { failed = true; return Promise.reject(new TypeError('network')); }
    return Promise.resolve(json({ updatedMappingCount: 1, updatedProjectCount: 1, affectedComponentCount: 5 }));
  } }); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '确认应用' }));
  await within(dialog).findByText('保存结果尚未确认，请使用原请求重试。');
  expect(within(dialog).getByRole('combobox', { name: '项目阶段' })).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: '确认应用' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(attempts[1].headers).toEqual(attempts[0].headers);
});

it('shows disabled project status in the bulk impact preview without implicitly enabling it', async () => {
  const requests: RequestInit[] = [];
  server({ intercept: (url, init) => {
    if (!url.pathname.endsWith('/bulk-preview')) return undefined;
    requests.push(init);
    return Promise.resolve(json({ ...bulkPreview, affectedProjects: bulkPreview.affectedProjects.map(item => ({ ...item, status: 'DISABLED' })) }));
  } }); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await within(dialog).findByText('停用');
  expect(JSON.parse(String(requests[0].body)).changes).toEqual({ stage: 'MASS_PRODUCTION' });
});

it('does not claim unselected components will change when the server reports selected-only mapping edits', async () => {
  server({ intercept: url => url.pathname.endsWith('/bulk-preview') ? Promise.resolve(json({ ...bulkPreview, affectedMappingsCount: 1 })) : undefined });
  mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置产品大类' }));
  fireEvent.change(within(dialog).getByLabelText('产品大类'), { target: { value: '新分类' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  await within(dialog).findByText('选中 1 条，影响 1 条组件');
  expect(within(dialog).queryByText('另有 4 条未选组件也将受影响')).not.toBeInTheDocument();
  expect(within(dialog).getByText('同项目另有 4 条未选组件')).toBeInTheDocument();
});

it('renders joined engineer identities on every shared component without per-row personnel or project requests', async () => {
  const joined: Summary = { ...summary, customerEngineer: engineer, projectEngineer: { ...engineer, assignmentId: 'assignment-b', userId: 'user-b', username: 'lisi', fullName: '李四', positionName: '项目工程师' } };
  const { reads } = server({ mappings: [{ ...mapping, project: joined }, { ...mapping, id: 'mapping-b', componentCode: 'COMP-002', project: joined }] }); mount();
  await screen.findAllByText('张三（zhangsan） · 质量工程师 / 项目质量室');
  expect(screen.getAllByText('张三（zhangsan） · 质量工程师 / 项目质量室')).toHaveLength(2);
  expect(screen.getAllByText('李四（lisi） · 项目工程师 / 项目质量室')).toHaveLength(2);
  expect(screen.queryByText('项目资料中查看')).not.toBeInTheDocument();
  expect(reads).toHaveLength(1);
  expect(reads[0].pathname).toMatch(/component-project-mappings$/);
});

it('treats nullable unconfigured engineers as allowed empty values without warning controls', async () => {
  server(); mount(); await screen.findByText('驱动总成');
  expect(screen.getAllByText('未配置')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '客户质量工程师任职已失效' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '项目质量工程师任职已失效' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('preserves an invalid configured engineer identity and exposes the reason through a focusable touch tooltip', async () => {
  const joined: Summary = { ...summary, customerEngineer: { ...engineer, valid: false, issues: ['USER_DISABLED'] } };
  server({ mappings: [{ ...mapping, project: joined }] }); mount();
  await screen.findByText('张三（zhangsan） · 质量工程师 / 项目质量室');
  const hint = screen.getByRole('button', { name: '客户质量工程师任职已失效' });
  act(() => hint.focus()); expect(hint).toHaveFocus();
  fireEvent.blur(hint); fireEvent.click(hint);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('用户已停用');
  expect(screen.queryByRole('button', { name: '项目质量工程师任职已失效' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('cleans the formal workspace when the real importer reports a current 401', async () => {
  const readScopes: Array<string | undefined> = [];
  const { reads } = server({ intercept: (url, init) => {
    if ((!init.method || init.method === 'GET') && url.pathname.endsWith('/component-project-mappings')) readScopes.push(useWorkTabsStore.getState().sessionScope);
    return init.method === 'POST' && url.pathname.endsWith('/component-project-mappings/import') ? Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)) : undefined;
  } });
  mount(); await screen.findByText('驱动总成');
  fireEvent.click(screen.getByRole('button', { name: '批量导入组件' }));
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('components');
  sheet.addRow(['组件号', '组件名称']); sheet.addRow(['IMPORT-401', '组件名称']);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'components.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  fireEvent.change(screen.getByLabelText('组件清单文件'), { target: { files: [file] } });
  await screen.findByText('IMPORT-401');
  fireEvent.click(screen.getByRole('button', { name: '导入组件' }));
  await screen.findByRole('heading', { name: '登录页' });
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(readScopes).toEqual(['INTERNAL:org-a:user-a']);
  expect(reads.filter(url => url.pathname.endsWith('/component-project-mappings'))).toHaveLength(1);
});

it('disambiguates same-name valid appointment options and table identities by username while preserving the selected assignment ID', async () => {
  const other: Assignment = { ...engineer, assignmentId: 'assignment-b', userId: 'user-b', username: 'zhangsan02' };
  const identities = [engineer, other];
  const joined: Summary = { ...summary, customerEngineer: engineer, projectEngineer: other };
  const { writes } = server({
    projects: [{ ...project, customerEngineerAssignmentId: engineer.assignmentId, projectEngineerAssignmentId: other.assignmentId }],
    mappings: [{ ...mapping, project: joined }],
    intercept: url => url.pathname.endsWith('/engineer-assignments') ? Promise.resolve(json({ items: identities, selected: identities.find(item => item.assignmentId === url.searchParams.get('selectedAssignmentId')) ?? null, total: 2, page: 1, pageSize: 20 })) : undefined,
  }); mount();
  await screen.findByText('驱动总成');
  const table = screen.getByRole('table');
  const dialog = await openProject();
  fireEvent.change(within(dialog).getByLabelText('项目编码'), { target: { value: 'P-IDENTITY' } });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '同名任职验证' } });
  await choose('项目阶段', '新品');
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '客户质量工程师' }));
  expect(await screen.findByRole('option', { name: '张三（zhangsan） · 质量工程师 / 项目质量室' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: '张三（zhangsan02） · 质量工程师 / 项目质量室' }));
  expect(within(table).getByText('张三（zhangsan） · 质量工程师 / 项目质量室')).toBeInTheDocument();
  expect(within(table).getByText('张三（zhangsan02） · 质量工程师 / 项目质量室')).toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: /^保\s*存$/ })).toBeEnabled());
  submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body.customerEngineerAssignmentId).toBe(other.assignmentId);
});

it.each([
  { fullName: '张三', username: null, expected: '张三 · 质量工程师 / 项目质量室' },
  { fullName: null, username: 'zhangsan', expected: 'zhangsan · 质量工程师 / 项目质量室' },
])('keeps the original identity fallback when fullName or username is absent: $expected', async ({ fullName, username, expected }) => {
  server({ mappings: [{ ...mapping, project: { ...summary, customerEngineer: { ...engineer, fullName, username } } }] }); mount();
  expect(await screen.findByText(expected)).toBeInTheDocument();
});

it('keeps read-only project engineers disabled without allowing selection, clearing, dirty state or writes', async () => {
  const { writes } = server({ projects: [{ ...project, customerEngineerAssignmentId: engineer.assignmentId, projectEngineerAssignmentId: engineer.assignmentId }] });
  mount({ ...organization, permissions: ['component-project:read'] });
  fireEvent.click(await screen.findByRole('button', { name: '查看项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  await waitFor(() => expect(within(dialog).getAllByText('张三（zhangsan） · 质量工程师 / 项目质量室')).toHaveLength(2));
  for (const label of ['客户质量工程师', '项目质量工程师']) {
    const picker = within(dialog).getByRole('combobox', { name: label });
    expect(picker).toBeDisabled();
    fireEvent.mouseDown(picker);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const clear = within(dialog).getByRole('button', { name: `清空${label}` });
    expect(clear).toBeDisabled(); fireEvent.click(clear);
  }
  expect(within(dialog).getAllByText('张三（zhangsan） · 质量工程师 / 项目质量室')).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭编辑器' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it('does not dispatch a single old-scope mutation when CSRF resolves after the scope unmounts', async () => {
  const token = deferred<Response>(); let waiting = false; let signal: AbortSignal | null | undefined;
  const { writes } = server({ intercept: (url, init) => {
    if (!url.pathname.endsWith('/csrf')) return undefined;
    waiting = true; signal = init.signal; return token.promise;
  } });
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑项目 P001' }));
  const dialog = await screen.findByRole('dialog', { name: '项目资料' });
  fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '等待 CSRF' } }); submit(dialog);
  await waitFor(() => expect(waiting).toBe(true));
  view.rerender(workspace({ ...organization, id: 'org-b', permissions: [] }));
  await act(async () => token.resolve(json({ csrfToken: 'late-token' })));
  expect(writes).toHaveLength(0);
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('无组件项目映射读取权限')).toBeInTheDocument();
});

it.each(['preview', 'apply'] as const)('does not dispatch an old-session bulk %s after its CSRF wait outlives the editor', async phase => {
  const token = deferred<Response>(); let csrfReads = 0; let waiting = false; let signal: AbortSignal | null | undefined;
  const requests: string[] = [];
  server({ intercept: (url, init) => {
    if (url.pathname.endsWith('/csrf')) {
      csrfReads++;
      if (phase === 'apply' && csrfReads === 1) return Promise.resolve(json({ csrfToken: 'preview-token' }));
      waiting = true; signal = init.signal; return token.promise;
    }
    if (url.pathname.endsWith('/bulk-preview')) { requests.push('preview'); return Promise.resolve(json(bulkPreview)); }
    if (url.pathname.endsWith('/bulk-apply')) { requests.push('apply'); return Promise.resolve(json({ updatedMappingCount: 1, updatedProjectCount: 1, affectedComponentCount: 5 })); }
    return undefined;
  } }); mount(); const dialog = await openBulk();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '设置项目阶段' }));
  await choose('项目阶段', '量产');
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  if (phase === 'apply') fireEvent.click(await within(dialog).findByRole('button', { name: '确认应用' }));
  await waitFor(() => expect(waiting).toBe(true));
  const acknowledged = [...requests];
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-b'));
  await act(async () => token.resolve(json({ csrfToken: 'late-token' })));
  expect(requests).toEqual(acknowledged);
  expect(requests.filter(item => item === phase)).toHaveLength(0);
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog', { name: '批量设置' })).not.toBeInTheDocument();
});

it('shows an independent category hint for an already-linked project and removes it after the category is saved and reread', async () => {
  const { writes } = server({ mappings: [{ ...mapping, productCategory: null }] }); mount();
  await screen.findByText('P001 · 电驱项目');
  expect(screen.queryByRole('button', { name: '未映射' })).not.toBeInTheDocument();
  const hint = screen.getByRole('button', { name: '产品大类未配置' });
  act(() => hint.focus()); expect(hint).toHaveFocus();
  fireEvent.blur(hint); fireEvent.click(hint);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('产品大类未配置，可稍后完善。');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '编辑组件 COMP-001' }));
  const dialog = await screen.findByRole('dialog', { name: '组件映射' });
  fireEvent.change(within(dialog).getByLabelText('产品大类'), { target: { value: '电驱' } }); submit(dialog);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ expectedVersion: mapping.version, productCategory: '电驱' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await screen.findByText('电驱');
  expect(screen.queryByRole('button', { name: '产品大类未配置' })).not.toBeInTheDocument();
});
