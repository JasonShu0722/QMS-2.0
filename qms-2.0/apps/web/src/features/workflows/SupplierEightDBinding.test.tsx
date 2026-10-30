import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { WorkflowListPage } from './WorkflowListPage';
import { SupplierEightDBinding } from './SupplierEightDBinding';
import * as api from './workflow-api';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('./workflow-api', async original => ({ ...await original<typeof api>(), getWorkflows: vi.fn(), getWorkflow: vi.fn(), getWorkflowVersion: vi.fn() }));
type Binding = components['schemas']['SupplierWorkflowBindingDto'];
const binding: Binding = { id: 'binding', organizationId: 'org', severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', workflowVersionId: 'published', workflowDefinitionId: 'definition', version: 4, enabled: false, controlledEightD: true, workflowStatus: 'PUBLISHED', responseSlaMinutes: null, createdById: 'user', createdAt: '2026-10-28T00:00:00Z' };
const head = { id: 'definition', organizationId: 'org', code: 'SUPPLIER', name: '供应商模板', description: null, revision: 1 };
const version = { id: 'published', workflowDefinitionId: 'definition', version: 1, status: 'PUBLISHED' as const, publishedAt: null, publishedById: null, changeNote: null };
const published = (): api.WorkflowDefinition => ({ ...head, version: { ...version, structureSnapshot: { nodes: [
  { id: 'owner', type: 'ACTION', name: '供应商', config: { isStart: true, assignment: { permission: 'supplier-quality:responses:write' }, supplierEightD: { schemaVersion: 1, reminderEveryHours: null } } },
  { id: 'review', type: 'APPROVAL', name: '审核', config: { closureReview: { schemaVersion: 1, policy: 'SUPPLIER', domainCode: 'supplier-quality' } } },
  { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true } },
], transitions: [
  { id: 'submit', from: 'owner', to: 'review', action: 'SUBMIT' },
  { id: 'return', from: 'review', to: 'owner', action: 'RETURN' },
  { id: 'approve', from: 'review', to: 'close', action: 'APPROVE' },
] } } });
let access: string[];
let items: Binding[];
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  access = ['configuration:read', 'configuration:manage', 'workflow:manage']; items = [binding];
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', organizationId: 'org', userId: 'user' } as Awaited<ReturnType<typeof getSession>>);
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version, draftVersionId: null }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [version] });
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(published());
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('my-permissions')) return { organizationId: 'org', permissions: access };
    if (path.includes('supplier-quality/workflow-bindings')) {
      if (init?.method === 'PUT') { const body = JSON.parse(init.body as string); return { ...binding, ...body, version: body.expectedVersion + 1 }; }
      return { items };
    }
    return null;
  });
});
const mount = () => render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><WorkflowListPage /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
const writes = () => vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path.includes('supplier-quality/workflow-bindings') && init?.method === 'PUT');
const ready = async () => { mount(); await waitFor(() => expect(screen.getByLabelText('供应商8D已发布流程版本')).toHaveValue('published')); };
it('mounts a separate supplier panel and saves disabled before explicit activation with a new key', async () => {
  await ready(); fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: 4, workflowVersionId: 'published', enabled: false });
  await waitFor(() => expect(screen.getByRole('button', { name: '启用供应商8D' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '启用供应商8D' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1][0]).toBe('/api/v1/supplier-quality/workflow-bindings/activation');
  expect(JSON.parse(writes()[1][1]!.body as string)).toEqual({ severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: 5, enabled: true });
  expect((writes()[1][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((writes()[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => path.includes('/publish') && init?.method === 'POST')).toBe(false);
});
it.each(['internal', 'legacy', 'duplicate-owner', 'duplicate-review', 'wrong-domain', 'draft', 'other-org', 'mixed-process', 'owner-type', 'owner-not-start', 'owner-end', 'second-start', 'owner-role', 'owner-user', 'owner-permission', 'owner-sla', 'owner-reminder', 'owner-escalation', 'marker-schema', 'marker-hours', 'review-type', 'review-start', 'review-end', 'review-schema'])('rejects %s as a new full supplier candidate', async kind => {
  items = [];
  const flow = published(); const nodes = flow.version.structureSnapshot.nodes;
  if (kind === 'internal') nodes[1].config!.closureReview!.policy = 'INTERNAL';
  if (kind === 'legacy') delete nodes[0].config!.supplierEightD;
  if (kind === 'duplicate-owner') nodes.push({ ...nodes[0], id: 'duplicate' });
  if (kind === 'duplicate-review') nodes.push({ ...nodes[1], id: 'duplicate' });
  if (kind === 'wrong-domain') nodes[1].config!.closureReview!.domainCode = 'customer-quality';
  if (kind === 'draft') flow.version.status = 'DRAFT';
  if (kind === 'other-org') flow.organizationId = 'other';
  if (kind === 'mixed-process') nodes[0].config!.processEightD = { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null };
  if (kind === 'owner-type') nodes[0].type = 'APPROVAL';
  if (kind === 'owner-not-start') nodes[0].config!.isStart = false;
  if (kind === 'owner-end') nodes[0].config!.isEnd = true;
  if (kind === 'second-start') nodes.push({ id: 'other-start', type: 'ACTION', name: '其他起点', config: { isStart: true } });
  if (kind === 'owner-role') nodes[0].config!.assignment!.roleCode = 'OLD';
  if (kind === 'owner-user') nodes[0].config!.assignment!.assigneeUserId = 'other';
  if (kind === 'owner-permission') nodes[0].config!.assignment!.permission = 'workflow:act';
  if (kind === 'owner-sla') nodes[0].config!.slaMinutes = 30;
  if (kind === 'owner-reminder') nodes[0].config!.reminders = [{ offsetMinutes: 0 }];
  if (kind === 'owner-escalation') nodes[0].config!.escalation = { roleCode: 'OLD' };
  if (kind === 'marker-schema') Object.assign(nodes[0].config!.supplierEightD!, { schemaVersion: 2 });
  if (kind === 'marker-hours') nodes[0].config!.supplierEightD!.reminderEveryHours = 1.5;
  if (kind === 'review-type') nodes[1].type = 'ACTION';
  if (kind === 'review-start') nodes[1].config!.isStart = true;
  if (kind === 'review-end') nodes[1].config!.isEnd = true;
  if (kind === 'review-schema') Object.assign(nodes[1].config!.closureReview!, { schemaVersion: 2 });
  vi.mocked(api.getWorkflowVersion).mockResolvedValue(flow);
  mount(); await screen.findByText('没有可选的供应商完整8D已发布流程，请先初始化模板并在设计器校验发布。');
  expect(screen.getByRole('button', { name: '保存供应商8D绑定' })).toBeDisabled();
});
it('preserves legacy rows read-only without migration or legacy activation', async () => {
  items = [{ ...binding, controlledEightD: false }, { ...binding, id: 'brief', responseForm: 'BRIEF' }];
  await ready(); expect(screen.getAllByText(/旧绑定仅供只读/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '保存供应商8D绑定' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '启用供应商8D' })).toBeDisabled(); expect(writes()).toHaveLength(0);
});
it('uses an actual published history version even when the list head is a new draft', async () => {
  const draft = { ...version, id: 'draft', version: 2, status: 'DRAFT' as const };
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version: draft, draftVersionId: 'draft' }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [draft, version] });
  await ready();
  expect(api.getWorkflowVersion).toHaveBeenCalledWith('definition', 'published', expect.any(AbortSignal));
  expect(vi.mocked(api.getWorkflowVersion).mock.calls.some(([, id]) => id === 'draft')).toBe(false);
  expect(screen.getByRole('link', { name: '查看供应商绑定候选流程' })).toHaveAttribute('href', '/console/workflows/definition/published');
  expect(writes()).toHaveLength(0);
});
it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)('creates a disabled independent %s binding without activating it', async severity => {
  items = []; mount();
  await waitFor(() => expect(screen.getByLabelText('供应商8D已发布流程版本')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('供应商绑定风险'), { target: { value: severity } });
  fireEvent.change(screen.getByLabelText('供应商8D已发布流程版本'), { target: { value: 'published' } });
  fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: 0, workflowVersionId: 'published', enabled: false });
  expect(writes()[0][0]).toBe('/api/v1/supplier-quality/workflow-bindings');
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => init?.method && ['POST', 'PUT', 'PATCH'].includes(init.method) && !path.includes('supplier-quality/workflow-bindings'))).toBe(false);
});
it.each(['configuration:read', 'configuration:manage', 'workflow:manage'])('does not infer missing %s from an administrator name', async missing => {
  access = access.filter(value => value !== missing); mount();
  if (missing === 'configuration:read') {
    await screen.findByText('当前会话无供应商配置读取权限');
    expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('supplier-quality/workflow-bindings'))).toBe(false);
  } else { await screen.findByText('供应商绑定管理需要配置管理与流程管理权限。'); expect(screen.getByRole('button', { name: '保存供应商8D绑定' })).toBeDisabled(); }
});
it.each([408, 425, 500, 0].flatMap(status => [false, true].map(activation => ({ status, activation }))))('freezes and retries original body/key after unknown status $status (activation=$activation)', async ({ status, activation }) => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; let failed = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings') && init?.method === 'PUT' && !failed) { failed = true; throw status ? new ApiError({ code: 'HTTP_ERROR', message: '' }, status) : new TypeError('network'); }
    return read(path, init);
  });
  await ready(); fireEvent.click(screen.getByRole('button', { name: activation ? '启用供应商8D' : '保存供应商8D绑定' }));
  await screen.findByText('供应商配置写入结果未确认，仅可重试原请求。');
  expect(screen.getByLabelText('供应商绑定风险')).toBeDisabled();
  expect(screen.getByRole('button', { name: '启用供应商8D' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原供应商配置请求' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1][1]!.body).toBe(writes()[0][1]!.body); expect(writes()[1][1]!.headers).toEqual(writes()[0][1]!.headers);
  expect(writes()[0][0]).toBe(`/api/v1/supplier-quality/workflow-bindings${activation ? '/activation' : ''}`);
});
it('keeps selection on 409 and explicitly reloads only the version baseline', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; let failed = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings') && init?.method === 'PUT' && !failed) { failed = true; items = [{ ...binding, version: 9 }]; throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409); }
    return read(path, init);
  });
  await ready(); fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await screen.findByText('供应商绑定版本冲突，输入已保留，请重读基线。');
  expect(screen.getByLabelText('供应商8D已发布流程版本')).toHaveValue('published');
  fireEvent.click(screen.getByRole('button', { name: '重读供应商配置基线' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存供应商8D绑定' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await waitFor(() => expect(writes()).toHaveLength(2)); expect(JSON.parse(writes()[1][1]!.body as string).expectedVersion).toBe(9);
});
it.each([401, 403])('clears sensitive state and aborts reads on %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings') && init?.method === 'PUT') throw new ApiError({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: '' }, status);
    return read(path, init);
  });
  await ready(); fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await screen.findByText('供应商配置访问失效，敏感内容已清除。');
  expect(screen.queryByLabelText('供应商8D已发布流程版本')).not.toBeInTheDocument();
  const signal = vi.mocked(apiRequest).mock.calls.find(([path]) => path.includes('supplier-quality/workflow-bindings'))![1]!.signal;
  expect(signal?.aborted).toBe(true);
});
it('aborts an old session while obtaining CSRF without sending the write', async () => {
  let finish!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await ready(); fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:other:user'));
  await act(async () => finish('csrf')); expect(writes()).toHaveLength(0);
});

it('guards an unsaved supplier risk change and retains the independent internal domain', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('供应商8D已发布流程版本'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('供应商绑定风险'), { target: { value: 'HIGH' } });
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('供应商绑定风险')).toHaveValue('LOW');
  expect(screen.getByLabelText('供应商8D已发布流程版本')).toHaveValue('');
  expect(screen.getByLabelText('8D绑定领域')).toHaveValue('process-quality');
  expect(writes()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('供应商绑定风险'), { target: { value: 'HIGH' } });
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(screen.getByLabelText('供应商绑定风险')).toHaveValue('HIGH');
  expect(screen.getByLabelText('供应商8D已发布流程版本')).toHaveValue('');
  expect(screen.getByRole('button', { name: '启用供应商8D' })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

it.each([400, 422, 429])('retains an uncertain binding through retry rejection %s until exact replay succeeds', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let count = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings') && init?.method === 'PUT') {
      if (++count === 1) throw new TypeError('network');
      if (count === 2) throw new ApiError({ code: 'VALIDATION_FAILED', message: '' }, status);
    }
    return read(path, init);
  });
  await ready(); fireEvent.click(screen.getByRole('button', { name: '保存供应商8D绑定' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原供应商配置请求' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试原供应商配置请求' })).toBeEnabled());
  expect(screen.getByLabelText('供应商绑定风险')).toBeDisabled();
  expect(screen.getByRole('button', { name: '重读供应商配置基线' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原供应商配置请求' }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes()[1][1]!.body).toBe(writes()[0][1]!.body);
  expect(writes()[2][1]!.body).toBe(writes()[0][1]!.body);
  expect(writes()[1][1]!.headers).toEqual(writes()[0][1]!.headers);
  expect(writes()[2][1]!.headers).toEqual(writes()[0][1]!.headers);
  await waitFor(() => expect(screen.queryByText('供应商配置写入结果未确认，仅可重试原请求。')).not.toBeInTheDocument());
});

it.each([401, 403])('clears a denied initial supplier read on %s without loading candidate identities', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }, status);
    return read(path, init);
  });
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><SupplierEightDBinding /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await screen.findByText('供应商配置访问失效，敏感内容已清除。');
  expect(api.getWorkflow).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('供应商8D已发布流程版本')).not.toBeInTheDocument();
  expect(screen.queryByText('unsafe')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it.each([false, true])('ignores old supplier read completion after scope replacement (denied=%s)', async denied => {
  let resolve!: (value: { items: Binding[] }) => void;
  let reject!: (cause: unknown) => void;
  const pending = new Promise<{ items: Binding[] }>((yes, no) => { resolve = yes; reject = no; });
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('supplier-quality/workflow-bindings') && useWorkTabsStore.getState().sessionScope === 'INTERNAL:org:user') return pending;
    return read(path, init);
  });
  mount(); await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('supplier-quality/workflow-bindings'))).toBe(true));
  const signal = vi.mocked(apiRequest).mock.calls.find(([path]) => path.includes('supplier-quality/workflow-bindings'))![1]!.signal;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:replacement'));
  expect(signal?.aborted).toBe(true);
  await act(async () => { if (denied) reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401)); else resolve({ items: [{ ...binding, workflowVersionId: 'old-secret-version' }] }); });
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:replacement');
  expect(screen.queryByText('供应商配置访问失效，敏感内容已清除。')).not.toBeInTheDocument();
  expect(screen.queryByText('old-secret-version')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
