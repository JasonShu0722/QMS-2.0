import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowDesignerPage } from './WorkflowDesignerPage';
import * as api from './workflow-api';
import { WorkflowProperties } from './WorkflowProperties';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

vi.mock('./workflow-api', () => ({ getWorkflowVersion: vi.fn(), getWorkflowOptions: vi.fn(), saveWorkflow: vi.fn(), publishWorkflow: vi.fn(), copyWorkflow: vi.fn(), validateWorkflow: vi.fn() }));
vi.mock('./WorkflowCanvas', () => ({ WorkflowCanvas: () => <div>Canvas</div> }));

const graph = { nodes: [
  { id: 'start', type: 'ACTION', name: '调查', config: { isStart: true, assignment: { roleCode: 'QA' } } },
  { id: 'end', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { roleCode: 'QA' } } },
], transitions: [{ id: 'finish', from: 'start', to: 'end', action: 'SUBMIT' }] };
const definition = { id: 'definition', organizationId: 'organization', code: 'QA', name: '质量流程', revision: 3,
  version: { id: 'version', workflowDefinitionId: 'definition', version: 1, status: 'DRAFT', structureSnapshot: graph } };
const response = (value: unknown) => value as Awaited<ReturnType<typeof api.getWorkflowVersion>>;
function mount() { return render(<MemoryRouter initialEntries={['/app/workflow-designer/definition/version']}><LanguageProvider><WorkflowDesignerPage definitionId="definition" versionId="version" /></LanguageProvider></MemoryRouter>); }

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  useWorkTabsStore.getState().reset();
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response(structuredClone(definition)));
  vi.mocked(api.getWorkflowOptions).mockResolvedValue({ roles: [{ code: 'QA', name: '质量' }], users: [], permissions: [] });
  vi.mocked(api.validateWorkflow).mockResolvedValue({ valid: true, errors: [] });
});

it.each([['DRAFT', '草稿编辑', '编辑'], ['PUBLISHED', '已发布查看', '查看'], ['RETIRED', '已停用版本查看', '查看']])('uses loaded object and %s version for hierarchy and work tab', async (status, action, tabAction) => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(response({ ...definition, version: { ...definition.version, status, version: 7 } }));
  mount();
  expect(await screen.findByRole('heading', { name: '质量流程' })).toBeVisible();
  expect(screen.getByRole('navigation', { name: '流程对象层级' })).toHaveTextContent(`系统服务/流程设计/质量流程/${action} · 版本 7`);
  expect(useWorkTabsStore.getState().tabs.find(tab => tab.path === '/app/workflow-designer/definition/version')).toMatchObject({ title: `质量流程 · ${tabAction}` });
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
  await waitFor(() => expect(api.publishWorkflow).toHaveBeenCalledWith('definition', expect.objectContaining({ draftVersionId: 'version', expectedRevision: 4 })));
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

it('keeps loaded content when permission is lost and disables subsequent mutations', async () => {
  vi.mocked(api.saveWorkflow).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 调查' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '仍可阅读的调查' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  expect(screen.getByLabelText('节点名称')).toHaveValue('仍可阅读的调查');
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
