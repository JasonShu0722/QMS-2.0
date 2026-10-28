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
vi.mock('./workflow-api', async original => ({ ...await original<typeof api>(), getWorkflows: vi.fn(), getWorkflow: vi.fn(), getWorkflowVersion: vi.fn() }));
const binding: components['schemas']['ProcessEightDBindingResultDto'] = { organizationId: 'org', workflowDefinitionId: 'definition', workflowVersionId: 'published', enabled: false, version: 4 };
const version = { id: 'draft', workflowDefinitionId: 'definition', version: 2, status: 'DRAFT' as const, publishedAt: null, publishedById: null, changeNote: null };
const head = { id: 'definition', organizationId: 'org', code: '8D', name: '过程8D流程', description: null, revision: 7 };
const publishedWorkflow = (domainCode: string): components['schemas']['WorkflowDefinitionResponseDto'] => ({ ...head, version: { ...version, id: 'published', version: 1, status: 'PUBLISHED', structureSnapshot: { nodes: [
  { id: 'owner', name: '负责人', type: 'ACTION', config: { isStart: true, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } },
  { id: 'review', name: '关闭审核', type: 'APPROVAL', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode } } },
], transitions: [] } } });
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:user:org');
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version, draftVersionId: 'draft' }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [version, { ...version, id: 'published', version: 1, status: 'PUBLISHED' }] });
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(publishedWorkflow('process-quality'));
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

it.each([
  { domain: 'customer-quality', label: '客户' },
  { domain: 'new-product-quality', label: '新品' },
] as const)('binds and explicitly activates only the fixed $domain endpoint from the real list entry', async ({ domain, label }) => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(publishedWorkflow(domain));
  mount();
  await waitFor(() => expect(screen.getByLabelText('8D绑定领域')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('8D绑定领域'), { target: { value: domain } });
  expect(await screen.findByRole('heading', { name: `${label}8D流程绑定与启用` })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeEnabled());
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/${domain}/eight-d/binding?organizationId=org`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/${domain}/eight-d/binding`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ organizationId: 'org', expectedVersion: 4, workflowDefinitionId: 'definition', workflowVersionId: 'published' }) }), { replayAfterReauthentication: false }));
  await waitFor(() => expect(screen.getByRole('button', { name: `启用${label}8D` })).toBeEnabled());
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.endsWith('/activation') && init?.method === 'PUT')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: `启用${label}8D` }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/${domain}/eight-d/activation`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ organizationId: 'org', expectedVersion: 5, enabled: true }) }), { replayAfterReauthentication: false }));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, init]) => init?.method === 'PUT' && !path.startsWith(`/api/v1/${domain}/eight-d/`))).toHaveLength(0);
  expect(vi.mocked(api.getWorkflowVersion).mock.calls.every(([, id]) => id === 'published')).toBe(true);
});

it.each(['process-quality', 'customer-quality', 'new-product-quality'] as const)('filters published INTERNAL candidates by %s instead of trusting arbitrary source domains', async domain => {
  const variants = ['matching', 'other-domain', 'supplier', 'no-review', 'foreign-org', 'mixed-domains', 'retired'];
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [...variants.map(id => ({ ...version, id, status: 'PUBLISHED' as const })), version] });
  vi.mocked(api.getWorkflowVersion).mockImplementation(async (_, id) => {
    const result = publishedWorkflow(id === 'other-domain' ? 'arbitrary-domain' : domain);
    result.version.id = id;
    if (id === 'supplier') result.version.structureSnapshot.nodes[1]!.config!.closureReview!.policy = 'SUPPLIER';
    if (id === 'no-review') result.version.structureSnapshot.nodes = [];
    if (id === 'foreign-org') result.organizationId = 'other';
    if (id === 'mixed-domains') result.version.structureSnapshot.nodes.push({ id: 'foreign-review', name: '异域审核', type: 'APPROVAL', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'supplier-quality' } } });
    if (id === 'retired') result.version.status = 'RETIRED';
    return result;
  });
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProcessEightDBinding domain={domain} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toBeEnabled());
  const selector = screen.getByLabelText('8D已发布流程版本') as HTMLSelectElement;
  expect(Array.from(selector.options).filter(option => option.value && !option.disabled).map(option => option.value)).toEqual(['matching']);
  expect(vi.mocked(api.getWorkflowVersion).mock.calls.some(([, id]) => id === 'draft')).toBe(false);
  expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('protects a dirty domain change and resets the binding scope only after explicit discard', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('8D已发布流程版本')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('8D已发布流程版本'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('8D绑定领域'), { target: { value: 'customer-quality' } });
  const keep = await screen.findByRole('button', { name: '继续编辑' });
  await waitFor(() => expect(keep).toBeVisible()); fireEvent.click(keep);
  expect(screen.getByLabelText('8D绑定领域')).toHaveValue('process-quality');
  expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('');
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/customer-quality/'))).toBe(false);
  fireEvent.change(screen.getByLabelText('8D绑定领域'), { target: { value: 'customer-quality' } });
  const discard = await screen.findByRole('button', { name: '放弃修改' });
  await waitFor(() => expect(discard).toBeVisible()); fireEvent.click(discard);
  expect(await screen.findByRole('heading', { name: '客户8D流程绑定与启用' })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('8D绑定领域')).toBeEnabled());
  expect(screen.getAllByRole('heading', { level: 3, name: /^(过程|客户|新品)8D流程绑定与启用$/ })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 3, name: '供应商8D流程绑定与启用' })).toBeVisible();
});

it.each(['customer-quality', 'new-product-quality'] as const)('keeps %s unknown requests private and blocks domain switches until exact retry succeeds', async domain => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(publishedWorkflow(domain));
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let writes = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT' && ++writes === 1) throw new ApiError({ code: 'CLIENT_REAUTHENTICATION_COMPLETED', message: 'reauthenticated' }, 0);
    return read(path, init);
  });
  mount(); await waitFor(() => expect(screen.getByLabelText('8D绑定领域')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('8D绑定领域'), { target: { value: domain } });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  const retry = await screen.findByRole('button', { name: '重试原配置请求' });
  expect(screen.getByLabelText('8D绑定领域')).toBeDisabled();
  expect(screen.getByLabelText('8D已发布流程版本')).toBeDisabled();
  expect(writes).toBe(1);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText('8D绑定领域')).toBeEnabled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]![0]).toBe(`/api/v1/${domain}/eight-d/binding`);
});

it.each([
  { domain: 'customer-quality', status: 409 }, { domain: 'new-product-quality', status: 409 },
  { domain: 'customer-quality', status: 403 }, { domain: 'new-product-quality', status: 403 },
] as const)('preserves CAS and revocation handling for $domain HTTP $status', async ({ domain, status }) => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(publishedWorkflow(domain));
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') throw new ApiError({ code: status === 409 ? 'CONCURRENCY_CONFLICT' : 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }, status);
    return read(path, init);
  });
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProcessEightDBinding domain={domain} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  expect(await screen.findByText(status === 409 ? '绑定版本已变化，选择已保留，请刷新基线后重试。' : '无权执行此操作')).toBeVisible();
  if (status === 409) {
    expect(screen.getByLabelText('8D已发布流程版本')).toHaveValue('published');
    expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeDisabled();
  } else {
    expect(screen.queryByLabelText('8D已发布流程版本')).not.toBeInTheDocument();
    expect(screen.queryByText('配置版本')).not.toBeInTheDocument();
  }
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});

it.each(['customer-quality', 'new-product-quality'] as const)('aborts %s writes before PUT after the session changes during CSRF', async domain => {
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(publishedWorkflow(domain));
  let finish!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount(); await waitFor(() => expect(screen.getByLabelText('8D绑定领域')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('8D绑定领域'), { target: { value: domain } });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存8D绑定' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存8D绑定' }));
  expect(screen.getByLabelText('8D绑定领域')).toBeDisabled();
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:other'));
  await act(async () => finish('csrf'));
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
