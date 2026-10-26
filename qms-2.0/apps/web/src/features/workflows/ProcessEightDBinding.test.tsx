import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { WorkflowListPage } from './WorkflowListPage';
import { ProcessEightDBinding } from './ProcessEightDBinding';
import * as api from './workflow-api';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));
vi.mock('./workflow-api', async original => ({ ...await original<typeof api>(), getWorkflows: vi.fn(), getWorkflow: vi.fn() }));
const binding: components['schemas']['ProcessEightDBindingResultDto'] = { organizationId: 'org', workflowDefinitionId: 'definition', workflowVersionId: 'published', enabled: false, version: 4 };
const version = { id: 'draft', workflowDefinitionId: 'definition', version: 2, status: 'DRAFT' as const, publishedAt: null, publishedById: null, changeNote: null };
const head = { id: 'definition', organizationId: 'org', code: '8D', name: '过程8D流程', description: null, revision: 7 };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:user:org');
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version, draftVersionId: 'draft' }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [version, { ...version, id: 'published', version: 1, status: 'PUBLISHED' }] });
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('my-permissions')) return { organizationId: 'org', permissions: ['workflow:manage', 'configuration:read', 'configuration:manage'] };
    if (init?.method === 'PUT') return { ...binding, version: 5 };
    return binding;
  });
});
afterEach(() => vi.unstubAllGlobals());
const mount = () => render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><WorkflowListPage /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
it('loads persisted binding and real published history, binding does not activate or publish a draft', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: '过程8D流程绑定与启用' })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  expect(Array.from((screen.getByLabelText('8D已发布流程版本') as HTMLSelectElement).options).map(item => item.value)).not.toContain('draft');
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/eight-d/binding', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ organizationId: 'org', expectedVersion: 4, workflowDefinitionId: 'definition', workflowVersionId: 'published' }) }), { replayAfterReauthentication: false }));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/activation') && init?.method === 'PUT')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '启用过程8D' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/eight-d/activation', expect.objectContaining({ body: JSON.stringify({ organizationId: 'org', expectedVersion: 5, enabled: true }) }), { replayAfterReauthentication: false }));
});
it('shows a configuration load failure without inventing workflow IDs or enabling writes', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('my-permissions')) return { organizationId: 'org', permissions: ['workflow:manage', 'configuration:read', 'configuration:manage'] };
    throw new Error('unsafe');
  });
  mount(); expect(await screen.findByText('无法加载8D绑定配置，请重试；不会使用默认流程ID。')).toBeVisible();
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '启用过程8D' })).toBeDisabled();
});
it('does not attempt configuration reads without the old session permission', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ organizationId: 'org', permissions: ['workflow:manage'] });
  mount(); expect(await screen.findByText('当前会话无配置读取权限')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/eight-d/binding'))).toBe(false);
});
it.each(['CONCURRENCY_CONFLICT', 'HTTP_409'])('keeps a denied binding selection on conflict %s', async code => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code, message: 'unsafe' }, 409);
    return read(path, init);
  });
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  expect(await screen.findByText('绑定版本已变化，选择已保留，请刷新基线后重试。')).toBeVisible();
  expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published');
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
});
it.each([403])('clears binding and selected published versions on %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }, status);
    return read(path, init);
  });
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  expect(await screen.findByText(status === 401 ? '请先登录' : '无权执行此操作')).toBeVisible();
  expect(screen.queryByLabelText('8D已发布流程版本')).not.toBeInTheDocument();
  expect(screen.queryByText('配置版本')).not.toBeInTheDocument();
});
it('completes binding 401 navigation past its busy guard and a parent dirty draft', async () => {
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'unsafe' }, 401);
    return read(path, init);
  });
  function Page() { useUnsavedChanges(true); return <ProcessEightDBinding />; }
  const router = createMemoryRouter([
    { path: '/app/workflow-designer', element: <LanguageProvider><UnsavedChangesProvider><Page /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/login', element: <p>8D配置登录目的页</p> },
  ], { initialEntries: ['/app/workflow-designer'] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(await screen.findByText('8D配置登录目的页')).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByLabelText('8D已发布流程版本')).not.toBeInTheDocument();
});
it('requires configuration manage in the old session even if workflow manage is present', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('my-permissions') ? { organizationId: 'org', permissions: ['workflow:manage', 'configuration:read'] } : binding);
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '启用过程8D' })).toBeDisabled();
});
it('shows an absent binding explicitly and only creates one using a selected real published version', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/eight-d/binding') && !init?.method ? null : read(path, init));
  mount(); expect(await screen.findByText('当前组织尚未绑定8D流程，请选择真实已发布版本后保存。')).toBeVisible();
  expect(screen.getByRole('button', { name: '启用过程8D' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('8D已发布流程版本'), { target: { value: 'published' } });
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/eight-d/binding', expect.objectContaining({ body: JSON.stringify({ organizationId: 'org', expectedVersion: 0, workflowDefinitionId: 'definition', workflowVersionId: 'published' }) }), { replayAfterReauthentication: false }));
});
it('aborts an old organization write while obtaining CSRF', async () => {
  let finish!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:other'));
  await act(async () => finish('csrf'));
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('protects an unsaved binding selection from a destructive baseline refresh', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.change(screen.getByLabelText('8D已发布流程版本'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '刷新8D配置基线' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('');
});
it.each(['network', 'HTTP_408', 'HTTP_425'])('retries an uncertain binding write with exactly the original payload and idempotency key after %s', async failure => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let writes = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') {
      writes++;
      if (writes === 1) throw failure === 'network' ? new TypeError('network') : new ApiError({ code: failure, message: 'unsafe' }, Number(failure.slice(5)));
    }
    return read(path, init);
  });
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await screen.findByText('配置写入结果未确认，输入已冻结，只能重试原请求。');
  expect(screen.getByLabelText('8D已发布流程版本')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原配置请求' }));
  await waitFor(() => expect(writes).toBe(2));
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
  expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers);
});

it.each([{ stage: 'CSRF', status: 429 }, { stage: 'PUT', status: 400 }, { stage: 'PUT', status: 422 }, { stage: 'PUT', status: 429 }])('retains an unknown binding after retry $stage $status until the original request succeeds', async ({ stage, status }) => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let failure: 'network' | number | undefined = 'network';
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') {
      if (failure === 'network') throw new TypeError('network');
      if (typeof failure === 'number') throw new ApiError({ code: `HTTP_${failure}`, message: 'refused' }, failure);
    }
    return read(path, init);
  });
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProcessEightDBinding /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await screen.findByText('配置写入结果未确认，输入已冻结，只能重试原请求。');
  expect(screen.getByLabelText('8D已发布流程版本')).toBeDisabled();
  failure = status;
  if (stage === 'CSRF') vi.mocked(csrfToken).mockRejectedValueOnce(new ApiError({ code: 'HTTP_429', message: 'refused' }, 429));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试原配置请求' })); });
  expect(screen.getByLabelText('8D已发布流程版本')).toBeDisabled();
  expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published');
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新8D配置基线' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试原配置请求' })).toBeEnabled();
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(stage === 'CSRF' ? 1 : 2);
  failure = undefined;
  fireEvent.click(screen.getByRole('button', { name: '重试原配置请求' }));
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toBeEnabled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(calls).toHaveLength(stage === 'CSRF' ? 2 : 3);
  for (const call of calls.slice(1)) expect(call).toEqual(calls[0]);
  expect(screen.queryByText('配置写入结果未确认，输入已冻结，只能重试原请求。')).not.toBeInTheDocument();
});

it.each([400, 422, 429])('keeps binding editable after initial explicit %s rejection', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code: `HTTP_${status}`, message: 'refused' }, status);
    return read(path, init);
  });
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProcessEightDBinding /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' })); });
  expect(screen.getByLabelText('8D已发布流程版本')).toBeEnabled();
  expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published');
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重试原配置请求' })).not.toBeInTheDocument();
});
