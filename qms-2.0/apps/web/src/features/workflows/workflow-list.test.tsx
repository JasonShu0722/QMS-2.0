import { transferableAbortController } from 'node:util';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { WorkflowListPage } from './WorkflowListPage';
import * as api from './workflow-api';

vi.mock('./workflow-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./workflow-api')>(), getWorkflows: vi.fn(), getWorkflow: vi.fn(), createWorkflow: vi.fn(), initialGraph: vi.fn(), workflowPath: vi.fn(), getWorkflowClosureTemplates: vi.fn(), createWorkflowClosureTemplate: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
});
afterEach(() => vi.unstubAllGlobals());
const renderList = () => render(<MemoryRouter><LanguageProvider><WorkflowListPage /></LanguageProvider></MemoryRouter>);
const renderGuardedList = () => {
  const router = createMemoryRouter([
    { path: '/app/workflow-designer', element: <LanguageProvider><UnsavedChangesProvider><WorkflowListPage /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/app/workflow-designer/:definitionId/:versionId', element: <p>Workflow designer</p> },
  ], { initialEntries: ['/app/workflow-designer'] });
  return { ...render(<RouterProvider router={router} />), router };
};
it('shows a read failure instead of an empty successful list and retries explicitly', async () => {
  vi.mocked(api.getWorkflows).mockRejectedValueOnce(new Error('raw unsafe')).mockResolvedValue({ items: [], total: 0 });
  renderList();
  expect(await screen.findByText('请求失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无流程')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('暂无流程')).toBeVisible();
});
it('lists exact historical versions without replacing their version IDs with the latest one', async () => {
  const version = { id: 'new', workflowDefinitionId: 'definition', version: 2, status: 'DRAFT' as const, publishedAt: null, publishedById: null, changeNote: null };
  const head = { id: 'definition', organizationId: 'org', code: 'QA', name: '质量流程', description: null, revision: 7 };
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version, draftVersionId: 'new' }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [version, { ...version, id: 'old', version: 1, status: 'PUBLISHED' }] });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: '版本历史 质量流程' }));
  expect(await screen.findByRole('link', { name: /版本 1/ })).toHaveAttribute('href', '/app/workflow-designer/definition/old');
  expect(screen.getByRole('link', { name: /版本 2/ })).toHaveAttribute('href', '/app/workflow-designer/definition/new');
});

it('guards a new workflow code and name when leaving the list and preserves them after cancel', async () => {
  const version = { id: 'version', workflowDefinitionId: 'definition', version: 1, status: 'DRAFT' as const, publishedAt: null, publishedById: null, changeNote: null };
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ id: 'definition', organizationId: 'organization', code: 'QA', name: '质量流程', description: null, revision: 1, version, draftVersionId: 'version' }], total: 1 });
  renderGuardedList();
  fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'NEW-FLOW' } });
  fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '新流程' } });
  fireEvent.click(await screen.findByRole('link', { name: '打开流程' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('流程代码')).toHaveValue('NEW-FLOW');
  expect(screen.getByLabelText('流程名称')).toHaveValue('新流程');
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeVisible();
});

it('creates a workflow once and opens its designer without an unsaved warning after completion', async () => {
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [], total: 0 });
  let finish!: (result: Awaited<ReturnType<typeof api.createWorkflow>>) => void;
  vi.mocked(api.createWorkflow).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(api.workflowPath).mockReturnValue('/app/workflow-designer/definition/version');
  const { router } = renderGuardedList();
  fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'NEW-FLOW' } });
  fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '新流程' } });
  const create = screen.getByRole('button', { name: '创建草稿' });
  fireEvent.click(create);
  expect(create).toBeDisabled();
  expect(screen.getByLabelText('流程代码')).toBeDisabled();
  expect(api.createWorkflow).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe('/app/workflow-designer');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => { finish({ id: 'definition', version: { id: 'version' } } as Awaited<ReturnType<typeof api.createWorkflow>>); });
  expect(await screen.findByText('Workflow designer')).toBeVisible();
  expect(router.state.location.pathname).toBe('/app/workflow-designer/definition/version');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('requires explicit discard before closing a filled new-workflow form', async () => {
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [], total: 0 });
  renderGuardedList();
  fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'KEEP-CODE' } });
  fireEvent.click(screen.getByRole('button', { name: '新建流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('流程代码')).toHaveValue('KEEP-CODE');
  fireEvent.click(screen.getByRole('button', { name: '新建流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByLabelText('流程代码')).not.toBeInTheDocument());
  expect(api.createWorkflow).not.toHaveBeenCalled();
});

it('initializes a candidate as a draft and navigates only after clearing its unsaved guard', async () => {
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getWorkflowClosureTemplates).mockResolvedValue({ items: [{ policy: 'INTERNAL', name: '内部关闭审核' }, { policy: 'SUPPLIER', name: '供应商关闭审核' }] });
  vi.mocked(api.createWorkflowClosureTemplate).mockResolvedValue({ id: 'definition', version: { id: 'version', status: 'DRAFT' } } as api.WorkflowDefinition);
  vi.mocked(api.workflowPath).mockReturnValue('/app/workflow-designer/definition/version');
  renderGuardedList();
  fireEvent.click(await screen.findByRole('button', { name: '初始化关闭审核模板' }));
  fireEvent.change(await screen.findByLabelText('模板领域代码'), { target: { value: 'INTERNAL_QUALITY' } });
  fireEvent.change(screen.getByLabelText('模板流程代码'), { target: { value: 'INTERNAL-CLOSE' } });
  fireEvent.change(screen.getByLabelText('模板流程名称'), { target: { value: '内部关闭流程' } });
  fireEvent.change(screen.getByLabelText('模板策略'), { target: { value: 'INTERNAL' } });
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  expect(await screen.findByText('Workflow designer')).toBeVisible();
  expect(api.createWorkflowClosureTemplate).toHaveBeenCalledTimes(1);
  expect(api.createWorkflow).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
