import { transferableAbortController } from 'node:util';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowDesignerPage } from './WorkflowDesignerPage';
import * as api from './workflow-api';
import { WorkflowProperties } from './WorkflowProperties';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('./workflow-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./workflow-api')>(), getWorkflowVersion: vi.fn(), getWorkflowOptions: vi.fn(), saveWorkflow: vi.fn(), publishWorkflow: vi.fn(), copyWorkflow: vi.fn(), validateWorkflow: vi.fn(), workflowPath: vi.fn() }));
vi.mock('./WorkflowCanvas', () => ({ WorkflowCanvas: () => <div>Canvas</div> }));

const graph = { nodes: [
  { id: 'start', type: 'ACTION', name: '调查', config: { isStart: true, assignment: { roleCode: 'QA' } } },
  { id: 'end', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { roleCode: 'QA' } } },
], transitions: [{ id: 'finish', from: 'start', to: 'end', action: 'SUBMIT' }] };
const definition = { id: 'definition', organizationId: 'organization', code: 'QA', name: '质量流程', revision: 3,
  version: { id: 'version', workflowDefinitionId: 'definition', version: 1, status: 'DRAFT', structureSnapshot: graph } };
const response = (value: unknown) => value as Awaited<ReturnType<typeof api.getWorkflowVersion>>;
const writeOptions = expect.objectContaining({ signal: expect.anything(), key: expect.any(String) });
function mount() { return render(<MemoryRouter initialEntries={['/console/workflows/definition/version']}><LanguageProvider><WorkflowDesignerPage definitionId="definition" versionId="version" /></LanguageProvider></MemoryRouter>); }
function mountGuarded() {
  const router = createMemoryRouter([
    { path: '/console/workflows/definition/version', element: <LanguageProvider><UnsavedChangesProvider><WorkflowDesignerPage definitionId="definition" versionId="version" /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/console/workflows', element: <p>Workflow list destination</p> },
    { path: '/console/workflows/definition/copied-version', element: <p>Copied workflow destination</p> },
  ], { initialEntries: ['/console/workflows/definition/version'] });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  // Keep the controller compatible with Node's native Request used by data routers.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  useWorkTabsStore.getState().reset();
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response(structuredClone(definition)));
  vi.mocked(api.getWorkflowOptions).mockResolvedValue({ roles: [{ code: 'QA', name: '质量' }], users: [], permissions: [] });
  vi.mocked(api.validateWorkflow).mockResolvedValue({ valid: true, errors: [] });
});
afterEach(() => vi.unstubAllGlobals());

it.each([['DRAFT', '草稿编辑'], ['PUBLISHED', '已发布查看'], ['RETIRED', '已停用版本查看']])('uses loaded object and %s version for console hierarchy without business tabs', async (status, action) => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response({ ...definition, version: { ...definition.version, status, version: 7 } }));
  mount();
  expect(await screen.findByRole('heading', { name: '质量流程' })).toBeVisible();
  expect(screen.getByRole('navigation', { name: '流程对象层级' })).toHaveTextContent(`管理控制台/流程设计/质量流程/${action} · 版本 7`);
  expect(screen.getByRole('link', { name: '管理控制台' })).toHaveAttribute('href', '/console');
  expect(screen.getByRole('link', { name: '受控流程列表' })).toHaveAttribute('href', '/console/workflows');
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(api.getWorkflowVersion).toHaveBeenCalledTimes(1);
});

it('preserves edits after stale revision conflict and does not retry the write automatically', async () => {
  vi.mocked(api.saveWorkflow).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'unsafe server content', traceId: 'workflow-trace' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '保留本地调查' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText('流程已被修改，本地草稿仍保留，请确认后重新加载。')).toBeVisible();
  expect(screen.getByLabelText('节点名称')).toHaveValue('保留本地调查');
  expect(screen.getByText('workflow-trace')).toBeVisible();
  expect(screen.queryByText('unsafe server content')).not.toBeInTheDocument();
  expect(api.saveWorkflow).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.saveWorkflow).mock.calls[0]?.[1]).toMatchObject({ draftVersionId: 'version', expectedRevision: 3 });
});

it('saves dirty content before publishing with the returned revision and freezes all editing', async () => {
  vi.mocked(api.saveWorkflow).mockImplementation(async (_id, body) => response({ ...definition, revision: 4, version: { ...definition.version, structureSnapshot: { nodes: body.nodes, transitions: body.transitions } } }));
  vi.mocked(api.publishWorkflow).mockResolvedValue(response({ ...definition, revision: 5, version: { ...definition.version, status: 'PUBLISHED' } }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新调查' } });
  fireEvent.click(screen.getByRole('button', { name: '发布流程' }));
  await waitFor(() => expect(api.publishWorkflow).toHaveBeenCalledWith('definition', expect.objectContaining({ draftVersionId: 'version', expectedRevision: 4 }), writeOptions));
  expect(api.saveWorkflow).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('已发布版本只读；如需修改，请复制为新草稿。')).toBeVisible();
  expect(screen.getByLabelText('节点名称')).toBeDisabled();
  expect(screen.getByRole('button', { name: '添加节点' })).toBeDisabled();
});

it('locates graph validation errors without losing unsaved content', async () => {
  vi.mocked(api.validateWorkflow).mockResolvedValue({ valid: false, errors: ['WORKFLOW_ASSIGNMENT_REQUIRED:end'] });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '校验流程' }));
  fireEvent.click(await screen.findByRole('button', { name: /WORKFLOW_ASSIGNMENT_REQUIRED:end/ }));
  expect(screen.getByLabelText('节点名称')).toHaveValue('关闭');
  expect(api.publishWorkflow).not.toHaveBeenCalled();
});

it('clears loaded content when permission is lost and disables subsequent mutations', async () => {
  vi.mocked(api.saveWorkflow).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '仍可阅读的调查' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  expect(screen.queryByLabelText('节点名称')).not.toBeInTheDocument();
  expect(screen.queryByText('质量流程')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
});

it('offers only executable CC transitions and preserves legal CLOSE return edges', () => {
  const create = (type: 'CC' | 'CLOSE', action: 'SUBMIT' | 'RETURN') => <LanguageProvider><WorkflowProperties
    graph={{ nodes: [{ id: 'source', name: 'source', type }, { id: 'target', name: 'target', type: 'ACTION' }], transitions: [{ id: 'edge', from: 'source', to: 'target', action }] }}
    selected="source" readOnly={false} options={{ roles: [], users: [], permissions: [] }} onChange={vi.fn()} onSelect={vi.fn()} /></LanguageProvider>;
  const view = render(create('CLOSE', 'RETURN'));
  expect(screen.getByLabelText('动作 edge')).toHaveValue('RETURN');
  view.rerender(create('CC', 'SUBMIT'));
  expect(Array.from((screen.getByLabelText('动作 edge') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['SUBMIT']);
});

it('confirms dirty reload through the shared guard and preserves the draft when cancelled', async () => {
  mountGuarded();
  fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '保留流程说明' } });
  fireEvent.change(screen.getByLabelText('发布说明'), { target: { value: '尚未发布的说明' } });
  fireEvent.click(screen.getByRole('button', { name: '重新加载流程' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(api.getWorkflowVersion).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('流程说明')).toHaveValue('保留流程说明');
  expect(screen.getByLabelText('发布说明')).toHaveValue('尚未发布的说明');
  fireEvent.click(screen.getByRole('button', { name: '重新加载流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(api.getWorkflowVersion).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText('流程说明')).toHaveValue(''));
  expect(screen.getByLabelText('发布说明')).toHaveValue('');
  expect(screen.queryByText('未保存', { exact: true })).not.toBeInTheDocument();
});

it('keeps an unpublished note dirty after saving the draft without pretending it was persisted', async () => {
  vi.mocked(api.saveWorkflow).mockResolvedValue(response({ ...definition, revision: 4, description: '保存的流程说明' }));
  mountGuarded();
  fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '保存的流程说明' } });
  fireEvent.change(screen.getByLabelText('发布说明'), { target: { value: '仅供发布时使用' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(api.saveWorkflow).toHaveBeenCalledWith('definition', expect.objectContaining({ description: '保存的流程说明', expectedRevision: 3, draftVersionId: 'version' }), writeOptions);
  expect(vi.mocked(api.saveWorkflow).mock.calls[0]![1]).not.toHaveProperty('changeNote');
  expect(screen.getByLabelText('发布说明')).toHaveValue('仅供发布时使用');
  expect(api.publishWorkflow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '受控流程列表' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('发布说明')).toHaveValue('仅供发布时使用');
});

it('publishes a note without saving an unchanged graph and becomes clean only after publication succeeds', async () => {
  vi.mocked(api.publishWorkflow).mockResolvedValue(response({ ...definition, revision: 4, version: { ...definition.version, status: 'PUBLISHED', changeNote: '修订发布说明' } }));
  const { router } = mountGuarded();
  fireEvent.change(await screen.findByLabelText('发布说明'), { target: { value: '修订发布说明' } });
  fireEvent.click(screen.getByRole('button', { name: '发布流程' }));
  expect(await screen.findByText('已发布版本只读；如需修改，请复制为新草稿。')).toBeVisible();
  expect(api.validateWorkflow).toHaveBeenCalledTimes(1);
  expect(api.saveWorkflow).not.toHaveBeenCalled();
  expect(api.publishWorkflow).toHaveBeenCalledWith('definition', { draftVersionId: 'version', expectedRevision: 3, changeNote: '修订发布说明' }, writeOptions);
  expect(screen.getByLabelText('发布说明')).toHaveValue('');
  expect(screen.queryByText('未保存', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '受控流程列表' }));
  expect(await screen.findByText('Workflow list destination')).toBeVisible();
  expect(router.state.location.pathname).toBe('/console/workflows');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('preserves the unpublished note after publication conflicts without repeating or saving the unchanged graph', async () => {
  vi.mocked(api.publishWorkflow).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'unsafe', traceId: 'publish-conflict' }));
  mountGuarded();
  fireEvent.change(await screen.findByLabelText('发布说明'), { target: { value: '冲突后保留的说明' } });
  fireEvent.click(screen.getByRole('button', { name: '发布流程' }));
  expect(await screen.findByText('publish-conflict')).toBeVisible();
  expect(screen.getByLabelText('发布说明')).toHaveValue('冲突后保留的说明');
  expect(api.publishWorkflow).toHaveBeenCalledTimes(1);
  expect(api.saveWorkflow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '受控流程列表' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('发布说明')).toHaveValue('冲突后保留的说明');
});

it('treats a publication note as unsaved input when leaving the designer', async () => {
  const { router } = mountGuarded();
  fireEvent.change(await screen.findByLabelText('发布说明'), { target: { value: '待发布修订说明' } });
  fireEvent.click(screen.getByRole('link', { name: '受控流程列表' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(router.state.location.pathname).toBe('/console/workflows/definition/version');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('发布说明')).toHaveValue('待发布修订说明');
});

it('holds navigation while a clean draft is being validated and resumes after completion', async () => {
  let finish!: (result: Awaited<ReturnType<typeof api.validateWorkflow>>) => void;
  vi.mocked(api.validateWorkflow).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { router } = mountGuarded();
  await waitFor(() => expect(screen.getByRole('button', { name: '校验流程' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '校验流程' }));
  await waitFor(() => expect(api.validateWorkflow).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: '受控流程列表' }));
  expect(router.state.location.pathname).toBe('/console/workflows/definition/version');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新加载流程' })).toBeDisabled();
  await act(async () => { finish({ valid: true, errors: [] }); });
  expect(await screen.findByText('Workflow list destination')).toBeVisible();
});

it('opens the copied draft after copying a published workflow finishes', async () => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response({ ...definition, version: { ...definition.version, status: 'PUBLISHED' } }));
  vi.mocked(api.copyWorkflow).mockResolvedValue(response({ ...definition, version: { ...definition.version, id: 'copied-version' } }));
  vi.mocked(api.workflowPath).mockReturnValue('/console/workflows/definition/copied-version');
  const { router } = mountGuarded();
  fireEvent.click(await screen.findByRole('button', { name: '复制为新草稿' }));
  expect(await screen.findByText('Copied workflow destination')).toBeVisible();
  expect(router.state.location.pathname).toBe('/console/workflows/definition/copied-version');
  expect(api.copyWorkflow).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

const closure = { schemaVersion: 1, policy: 'SUPPLIER', domainCode: 'SUPPLIER_QUALITY' } as const;
function mountProperties(config: NonNullable<api.WorkflowNode['config']> = {}, readOnly = false, type: api.WorkflowNode['type'] = 'APPROVAL') {
  const changed = vi.fn();
  function Editor() {
    const [value, setValue] = useState<api.WorkflowGraph>({ nodes: [{ id: 'review', type, name: '关闭审核', config }], transitions: [] });
    return <WorkflowProperties graph={value} selected="review" readOnly={readOnly} options={{ roles: [{ code: 'QA', name: '质量' }], users: [{ id: 'person', name: '工程师' }], permissions: [] }} onChange={next => { changed(next); setValue(next); }} onSelect={vi.fn()} />;
  }
  render(<LanguageProvider><Editor /></LanguageProvider>);
  return changed;
}

it('replaces static assignment and escalation with explicit controlled closure rules without inventing UUIDs', () => {
  const changed = mountProperties({ assignment: { roleCode: 'QA', assigneeUserId: 'person' }, escalation: { roleCode: 'QA' }, slaMinutes: 60, editorPosition: { x: 10, y: 20 } });
  fireEvent.click(screen.getByLabelText('受控关闭审核'));
  expect(screen.getByText(/专业审核与管理审核/)).toBeVisible();
  expect(screen.queryByLabelText('处理范围 角色')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('超时通知负责人 角色')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('关闭审核策略'), { target: { value: 'SUPPLIER' } });
  fireEvent.change(screen.getByLabelText('关闭审核领域代码'), { target: { value: 'SUPPLIER_QUALITY' } });
  expect(screen.getByLabelText('关闭审核领域代码')).toBeRequired();
  const config = changed.mock.lastCall![0].nodes[0].config;
  expect(config.closureReview).toEqual(closure);
  expect(config.assignment).toBeUndefined();
  expect(config.escalation).toBeUndefined();
  expect(config.editorPosition).toEqual({ x: 10, y: 20 });
  fireEvent.click(screen.getByLabelText('受控关闭审核'));
  expect(screen.getByLabelText('处理范围 角色')).toHaveValue('');
  expect(screen.getByLabelText('处理范围 处理人')).toHaveValue('');
  expect(screen.getByText(/关闭后须手动配置普通处理范围/)).toBeVisible();
});

it.each(['ACTION', 'VERIFICATION', 'CC', 'CLOSE'] as const)('clears closure metadata when switching an approval to %s', type => {
  const changed = mountProperties({ closureReview: closure });
  fireEvent.change(screen.getByLabelText('节点类型'), { target: { value: type } });
  expect(changed.mock.lastCall![0].nodes[0].config.closureReview).toBeUndefined();
  expect(screen.queryByLabelText('受控关闭审核')).not.toBeInTheDocument();
});

it.each([{ isStart: true }, { isEnd: true }])('does not offer controlled closure on a boundary approval %j', config => {
  mountProperties(config);
  expect(screen.queryByLabelText('受控关闭审核')).not.toBeInTheDocument();
});

it('reads published closure rules without allowing edits or losing old static directory choices', () => {
  const changed = mountProperties({ closureReview: closure }, true);
  expect(screen.getByLabelText('关闭审核策略')).toHaveValue('SUPPLIER');
  expect(screen.getByLabelText('关闭审核领域代码')).toBeDisabled();
  expect(screen.getByLabelText('受控关闭审核')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('关闭审核领域代码'), { target: { value: 'BAD' } });
  expect(changed).not.toHaveBeenCalled();
});

it('keeps ordinary role and user options available for legacy workflows', () => {
  mountProperties({ assignment: { roleCode: 'QA', assigneeUserId: 'person' } });
  expect(screen.getByLabelText('处理范围 角色')).toHaveValue('QA');
  expect(screen.getByLabelText('处理范围 处理人')).toHaveValue('person');
});

it('preserves closure metadata through an unrelated edit and the real graph save boundary', async () => {
  const snapshot = { nodes: [{ id: 'review', name: '关闭审核', type: 'APPROVAL', config: { closureReview: closure, editorPosition: { x: 10, y: 20 } } }], transitions: [] };
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response({ ...definition, version: { ...definition.version, structureSnapshot: snapshot } }));
  vi.mocked(api.saveWorkflow).mockResolvedValue(response({ ...definition, version: { ...definition.version, structureSnapshot: snapshot } }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 关闭审核' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '保留受控规则' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledWith('definition', expect.objectContaining({ nodes: [expect.objectContaining({ name: '保留受控规则', config: { closureReview: closure, editorPosition: { x: 10, y: 20 } } })] }), writeOptions));
});

it('saves edited closure policy and domain code and reads them back through the designer reload', async () => {
  let saved = response({ ...definition, version: { ...definition.version, structureSnapshot: {
    nodes: [...graph.nodes, { id: 'review', name: '关闭审核', type: 'APPROVAL', config: {
      closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'INTERNAL_QUALITY' }, editorPosition: { x: 10, y: 20 },
    } }], transitions: graph.transitions,
  } } });
  vi.mocked(api.getWorkflowVersion).mockImplementation(async () => structuredClone(saved));
  vi.mocked(api.saveWorkflow).mockImplementation(async (_id, body) => {
    saved = response({ ...saved, revision: 4, version: { ...saved.version, structureSnapshot: {
      nodes: structuredClone(body.nodes), transitions: structuredClone(body.transitions),
    } } });
    return structuredClone(saved);
  });
  mountGuarded();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 关闭审核' }));
  expect(screen.getByLabelText('关闭审核策略')).toHaveValue('INTERNAL');
  expect(screen.getByLabelText('关闭审核领域代码')).toHaveValue('INTERNAL_QUALITY');
  fireEvent.change(screen.getByLabelText('关闭审核策略'), { target: { value: 'SUPPLIER' } });
  fireEvent.change(screen.getByLabelText('关闭审核领域代码'), { target: { value: 'SUPPLIER_QUALITY' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(api.saveWorkflow).toHaveBeenCalledExactlyOnceWith('definition', expect.objectContaining({
    draftVersionId: 'version', expectedRevision: 3,
    nodes: expect.arrayContaining([expect.objectContaining({ id: 'review', config: {
      closureReview: closure, editorPosition: { x: 10, y: 20 },
    } })]),
  }), writeOptions);
  expect(screen.queryByText('未保存', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载流程' }));
  await waitFor(() => expect(api.getWorkflowVersion).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(screen.getByLabelText('关闭审核策略')).toHaveValue('SUPPLIER');
  expect(screen.getByLabelText('关闭审核领域代码')).toHaveValue('SUPPLIER_QUALITY');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.publishWorkflow).not.toHaveBeenCalled();
});

it('saves the exact controlled 8D owner reminder policy through the generated graph contract', async () => {
  const snapshot = structuredClone(graph);
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response({ ...definition, version: { ...definition.version, structureSnapshot: snapshot } }));
  vi.mocked(api.saveWorkflow).mockImplementation(async (_id, body) => response({ ...definition, revision: 4, version: { ...definition.version, structureSnapshot: { nodes: body.nodes, transitions: body.transitions } } }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  fireEvent.click(screen.getByLabelText('过程8D负责人处理'));
  fireEvent.change(screen.getByLabelText('8D提醒间隔（小时）'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledWith('definition', expect.objectContaining({
    nodes: expect.arrayContaining([expect.objectContaining({ id: 'start', config: {
      isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 12 },
    } })]),
  }), writeOptions));
  expect(screen.getByLabelText('8D提醒间隔（小时）')).toHaveValue(12);
  expect(api.publishWorkflow).not.toHaveBeenCalled();
});

it('clears the graph on session expiry without accepting a late directory response', async () => {
  let finish!: (value: api.WorkflowOptions) => void;
  vi.mocked(api.getWorkflowOptions).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(api.saveWorkflow).mockRejectedValue(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'unsafe' }, 401));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  await waitFor(() => expect(api.getWorkflowOptions).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText('请先登录')).toBeVisible();
  await act(async () => finish({ roles: [{ code: 'LEAK', name: '不可泄露的岗位' }], users: [], permissions: [] }));
  expect(screen.queryByLabelText('节点名称')).not.toBeInTheDocument();
  expect(screen.queryByText('不可泄露的岗位')).not.toBeInTheDocument();
});

it('does not paint a workflow response from an old session after organization change', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:user:old-org');
  let finish!: (value: api.WorkflowDefinition) => void;
  vi.mocked(api.getWorkflowVersion).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mount();
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:new-org'));
  await act(async () => finish(response({ ...definition, name: '不可泄露的旧流程' })));
  expect(screen.queryByText('不可泄露的旧流程')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '质量流程' })).toBeVisible();
});
