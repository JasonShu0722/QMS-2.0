import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
import { ConsoleWorkflowPage } from '../../console/ConsoleWorkflowPage';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import * as api from './workflow-api';

type Context = components['schemas']['ConsoleContextDto'];
const verified = vi.hoisted(() => ({ context: {} as Context, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../console/ConsoleLayout', () => ({ useConsoleContext: () => verified }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn() }));
vi.mock('./workflow-api', async original => ({ ...await original<typeof import('./workflow-api')>(), getWorkflows: vi.fn(), getWorkflow: vi.fn(), getWorkflowVersion: vi.fn(), getWorkflowOptions: vi.fn(), createWorkflow: vi.fn(), saveWorkflow: vi.fn(), publishWorkflow: vi.fn(), copyWorkflow: vi.fn(), validateWorkflow: vi.fn(), getWorkflowClosureTemplates: vi.fn() }));

const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const definitionId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const nextVersion = '55555555-5555-4555-8555-555555555555';
const home = { id: homeId, code: 'HOME', name: '会话组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '管理目标B' };
const detailPath = `/console/workflows/${definitionId}/${versionId}`;
const definition = (): api.WorkflowDefinition => ({ id: definitionId, organizationId: homeId, code: 'QA', name: '真实受控流程', description: '', revision: 3,
  version: { id: versionId, workflowDefinitionId: definitionId, version: 1, status: 'DRAFT', publishedAt: null, publishedById: null, changeNote: null,
    structureSnapshot: { nodes: [{ id: 'handle', type: 'ACTION', name: '调查', config: { isStart: true, assignment: { roleCode: 'QA' } } }, { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true } }], transitions: [] } } });
function context(): Context { return { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: false,
  modules: [{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['workflow:manage'] }] }; }
function Controls() { const location = useLocation(); return <output aria-label="workflow-url">{location.pathname}{location.search}</output>; }
function tree(path: string) { return <MemoryRouter initialEntries={[path]}><LanguageProvider><UnsavedChangesProvider><Controls /><ConsoleWorkflowPage /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>; }
function view(path = '/console/workflows') { return render(tree(path)); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:actor`); verified.context = context();
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(definition());
  vi.mocked(api.getWorkflowOptions).mockResolvedValue({ roles: [{ code: 'QA', name: '质量' }], users: [], permissions: [] });
  vi.mocked(api.validateWorkflow).mockResolvedValue({ valid: true, errors: [] });
  vi.mocked(api.getWorkflowClosureTemplates).mockResolvedValue({ items: [{ policy: 'INTERNAL', name: '内部关闭审核' }, { policy: 'SUPPLIER', name: '供应商关闭审核' }] });
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path === '/api/v1/system/my-permissions') return { organizationId: homeId, permissions: ['workflow:manage'] };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

it('opens the actual list and both binding panels for workflow-only staff while target B never becomes the session home', async () => {
  view(`/console/workflows?organizationId=${targetId}`);
  expect(await screen.findByText('暂无流程')).toBeVisible();
  expect(screen.getByRole('heading', { name: '过程8D流程绑定与启用' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '供应商8D流程绑定与启用' })).toBeVisible();
  expect(screen.getByLabelText('8D绑定领域')).toHaveTextContent('过程质量客户质量新品质量');
  expect(screen.getByRole('button', { name: '初始化关闭审核模板' })).toBeEnabled();
  expect(vi.mocked(api.getWorkflows).mock.calls[0][0].has('organizationId')).toBe(false);
  expect(vi.mocked(apiRequest).mock.calls.every(([path]) => path === '/api/v1/system/my-permissions')).toBe(true);
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});

it.each([
  '/console/workflows/invalid/invalid', `/console/workflows/${definitionId}`, `${detailPath}/extra`, '/app/workflow-designer', '/console/users',
  `/console/workflows/${definitionId.replace('-4333-', '-0333-')}/${versionId}`, `/console/workflows/${definitionId}/${versionId.replace('-8444-', '-7444-')}`,
  '/console/workflows?section=workflows', '/console/workflows?organizationId=bad', `/console/workflows?organizationId=${homeId}`,
  `/console/workflows?organizationId=${targetId}&organizationId=${targetId}`, '/console/workflows?%zz=value',
])('rejects invalid or out-of-scope deep link %s before mounting any workflow reader', async path => {
  view(path);
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.queryByRole('button', { name: '新建流程' })).not.toBeInTheDocument();
  expect(api.getWorkflows).not.toHaveBeenCalled(); expect(api.getWorkflowVersion).not.toHaveBeenCalled(); expect(apiRequest).not.toHaveBeenCalled();
});

it.each(['permission', 'scope', 'coverage', 'organization', 'session', 'module'] as const)('rejects invalid workflow authority: %s', kind => {
  const module = verified.context.modules[0];
  if (kind === 'permission') module.permissions = ['account:users:read'];
  if (kind === 'scope') module.scope = 'TARGET';
  if (kind === 'coverage') module.coverage = 'PLATFORM';
  if (kind === 'organization') module.organizationId = targetId;
  if (kind === 'session') useWorkTabsStore.getState().bindSession(`INTERNAL:${targetId}:actor`);
  if (kind === 'module') verified.context.modules = [];
  view(); expect(screen.getByRole('alert')).toBeVisible(); expect(api.getWorkflows).not.toHaveBeenCalled(); expect(apiRequest).not.toHaveBeenCalled();
});

it('renders the real designer and canvas without adding or replacing an existing business tab', async () => {
  useWorkTabsStore.getState().openTab({ id: 'business', path: '/app/account', title: '业务窗口' });
  const tabs = useWorkTabsStore.getState().tabs;
  const page = view(`${detailPath}?organizationId=${targetId}`);
  expect(await screen.findByRole('heading', { name: '真实受控流程' })).toBeVisible();
  await waitFor(() => expect(page.container.querySelector('.react-flow')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: '受控流程列表' })).toHaveAttribute('href', '/console/workflows');
  expect(api.getWorkflowVersion).toHaveBeenCalledWith(definitionId, versionId, expect.any(AbortSignal));
  expect(useWorkTabsStore.getState().tabs).toEqual(tabs);
});

it('matches standard uppercase UUID deep links against canonical response IDs without substituting another object', async () => {
  const flow = definition(); flow.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; flow.version.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; flow.version.workflowDefinitionId = flow.id;
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(flow);
  view(`/console/workflows/${flow.id.toUpperCase()}/${flow.version.id.toUpperCase()}`);
  expect(await screen.findByRole('heading', { name: '真实受控流程' })).toBeVisible();
  expect(api.getWorkflowVersion).toHaveBeenCalledWith(flow.id.toUpperCase(), flow.version.id.toUpperCase(), expect.any(AbortSignal));
});

it('creates in the real home session without adding target organization fields and enters the exact new console version', async () => {
  const created = definition(); created.version.id = nextVersion;
  vi.mocked(api.createWorkflow).mockResolvedValue(created);
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(created);
  view(`/console/workflows?organizationId=${targetId}`);
  fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '新流程' } });
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  expect(await screen.findByRole('heading', { name: '真实受控流程' })).toBeVisible();
  expect(screen.getByLabelText('workflow-url')).toHaveTextContent(`/console/workflows/${definitionId}/${nextVersion}`);
  const [body, options] = vi.mocked(api.createWorkflow).mock.calls[0];
  expect(JSON.parse(body as string)).toMatchObject({ code: 'NEW', name: '新流程' });
  expect(body).not.toContain('organizationId'); expect(body).not.toContain(targetId);
  expect(options).toMatchObject({ key: expect.any(String), signal: expect.any(AbortSignal) });
});

it('keeps a template portal and unsaved input across equivalent context refresh, including display metadata changes', async () => {
  const page = view();
  await screen.findByText('暂无流程');
  fireEvent.click(await screen.findByRole('button', { name: '初始化关闭审核模板' }));
  await waitFor(() => expect(screen.getByLabelText('模板流程名称')).toBeEnabled());
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  const portal = screen.getByRole('dialog');
  fireEvent.change(screen.getByLabelText('模板流程名称'), { target: { value: '保留模板草稿' } });
  verified.context = structuredClone(verified.context); verified.context.actor.homeOrganization.name = '更新组织名称'; verified.context.organizations.push({ ...target, id: nextVersion });
  page.rerender(tree('/console/workflows'));
  expect(screen.getByRole('dialog')).toBe(portal); expect(portal).toBeVisible(); expect(screen.getByLabelText('模板流程名称')).toHaveValue('保留模板草稿');
  expect(api.getWorkflows).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('模板流程名称')).toHaveValue('保留模板草稿');
});

it('preserves real designer input across equivalent context refresh and retains CAS in a home-session save', async () => {
  const saved = definition(); saved.description = '保留设计草稿'; saved.revision = 4; vi.mocked(api.saveWorkflow).mockResolvedValue(saved);
  const page = view(detailPath); await screen.findByRole('heading', { name: '真实受控流程' });
  fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '保留设计草稿' } });
  verified.context = structuredClone(verified.context); verified.context.targetOrganization.name = '重命名目标B';
  page.rerender(tree(detailPath));
  expect(screen.getByLabelText('流程说明')).toHaveValue('保留设计草稿'); expect(api.getWorkflowVersion).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledWith(definitionId, expect.objectContaining({ description: '保留设计草稿', draftVersionId: versionId, expectedRevision: 3 }), expect.objectContaining({ key: expect.any(String), signal: expect.any(AbortSignal) })));
  expect(JSON.stringify(vi.mocked(api.saveWorkflow).mock.calls[0][1])).not.toContain('organizationId');
});

it.each(['organization', 'definition', 'version'] as const)('does not display or edit a mismatched %s returned for a valid deep link', async kind => {
  const wrong = definition();
  if (kind === 'organization') wrong.organizationId = targetId;
  if (kind === 'definition') wrong.id = targetId;
  if (kind === 'version') wrong.version.id = nextVersion;
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(wrong);
  view(detailPath);
  expect(await screen.findByRole('alert')).toBeVisible(); expect(screen.queryByRole('heading', { name: '真实受控流程' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument(); expect(api.saveWorkflow).not.toHaveBeenCalled();
});

it('clears an out-of-home list response instead of exposing its workflow names', async () => {
  const foreign = definition(); foreign.organizationId = targetId;
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...foreign, draftVersionId: versionId }], total: 1 });
  view(); await screen.findByText('无权访问该组织');
  expect(screen.queryByText('真实受控流程')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: '新建流程' })).toBeDisabled();
});

it('refuses a history response belonging to a different definition or organization', async () => {
  const flow = definition();
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...flow, draftVersionId: versionId }], total: 1 });
  const { version, ...head } = flow;
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, id: targetId, organizationId: targetId, name: '不可展示的其他流程', versions: [version] });
  view(); fireEvent.click(await screen.findByRole('button', { name: '版本历史 真实受控流程' }));
  await screen.findByText('无权访问该组织'); expect(screen.queryByText('不可展示的其他流程')).not.toBeInTheDocument();
});

it('clears a forbidden create response and never navigates to the foreign returned object', async () => {
  const foreign = definition(); foreign.organizationId = targetId; vi.mocked(api.createWorkflow).mockResolvedValue(foreign);
  view(); fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'NEW' } }); fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '新流程' } });
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  await screen.findByText('无权访问该组织'); expect(screen.getByLabelText('workflow-url')).toHaveTextContent('/console/workflows');
  expect(api.getWorkflowVersion).not.toHaveBeenCalled(); expect(screen.queryByLabelText('流程名称')).not.toBeInTheDocument();
});

it('rejects a foreign copied organization even when its new version ID is valid', async () => {
  const published = definition(); published.version.status = 'PUBLISHED'; vi.mocked(api.getWorkflowVersion).mockResolvedValue(published);
  const foreign = definition(); foreign.organizationId = targetId; foreign.version.id = nextVersion; vi.mocked(api.copyWorkflow).mockResolvedValue(foreign);
  view(detailPath); fireEvent.click(await screen.findByRole('button', { name: '复制为新草稿' }));
  await screen.findByText('无权访问该组织'); expect(screen.getByLabelText('workflow-url')).toHaveTextContent(detailPath); expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument();
});

it('accepts a legitimate new copied version ID and opens the new console draft', async () => {
  const published = definition(); published.version.status = 'PUBLISHED';
  const copied = definition(); copied.version.id = nextVersion;
  vi.mocked(api.getWorkflowVersion).mockResolvedValueOnce(published).mockResolvedValue(copied); vi.mocked(api.copyWorkflow).mockResolvedValue(copied);
  view(detailPath); fireEvent.click(await screen.findByRole('button', { name: '复制为新草稿' }));
  await waitFor(() => expect(screen.getByLabelText('workflow-url')).toHaveTextContent(`/console/workflows/${definitionId}/${nextVersion}`));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(api.copyWorkflow).toHaveBeenCalledWith(definitionId, expect.objectContaining({ sourceVersionId: versionId, expectedRevision: 3 }), expect.objectContaining({ key: expect.any(String), signal: expect.any(AbortSignal) }));
});

it('never paints a late sensitive response after capability loss and re-entry into the same route', async () => {
  let finish!: (result: api.WorkflowDefinition) => void;
  vi.mocked(api.getWorkflowVersion).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const page = view(detailPath);
  verified.context = { ...verified.context, modules: [] }; page.rerender(tree(detailPath));
  verified.context = context(); page.rerender(tree(detailPath));
  await screen.findByRole('heading', { name: '真实受控流程' });
  await act(async () => finish({ ...definition(), name: '不可泄露的旧请求' }));
  expect(screen.queryByText('不可泄露的旧请求')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '真实受控流程' })).toBeVisible();
});

it('clears sensitive workflow content immediately after real capability or identity loss', async () => {
  const page = view(detailPath); await screen.findByRole('heading', { name: '真实受控流程' });
  fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '敏感草稿' } });
  verified.context = { ...verified.context, modules: [] }; page.rerender(tree(detailPath));
  expect(screen.getByRole('alert')).toBeVisible(); expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument();
  verified.context = context(); await act(async () => useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`)); page.rerender(tree(detailPath));
  expect(screen.queryByRole('heading', { name: '真实受控流程' })).not.toBeInTheDocument();
});
