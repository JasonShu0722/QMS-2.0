import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { apiRequest } from '../../api/client';
import { SupplierEightDWorkspace } from './SupplierEightDWorkspace';
import { SupplierControlledReport } from './SupplierControlledReport';

type Report = components['schemas']['SupplierEightDReportDto'];
const report: Report = {
  supplierProblemId: 'supplier-1', problemId: 'problem-1', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1',
  title: '供应商正式整改', reportNumber: 'SQ-001', severity: 'HIGH', status: 'PROCESSING', rowVersion: 4, contentVersion: 6, instanceVersion: 2,
  sqeUserId: 'sqe-1', sqeAssignmentId: 'assignment-1', responsibleSectionDepartmentId: 'section-1',
  submittedRevisionId: null, approvedRevisionId: null, analysisDueAt: null, analysisCompletedAt: null, submissionDueAt: null, submittedAt: null,
  closureDueAt: null, closedAt: null, releasedToSupplierAt: null, closure: null, allowedActions: ['read', 'save', 'analysis-complete', 'submit'],
  document: { description: '供应商实际问题', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
let current: Report;
let writes: { path: string; init: RequestInit; body: Record<string, unknown> }[];
let failure: number | 'network' | undefined;
let fetcher: ReturnType<typeof vi.fn>;
let actor: { accountType: 'INTERNAL' | 'SUPPLIER'; organizationId: string; id: string };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function mount(portal = false, id = 'supplier-1', onDenied = vi.fn()) {
  if (portal) actor = { accountType: 'SUPPLIER', organizationId: 'vendor-1', id: 'vendor-user' };
  useWorkTabsStore.getState().bindSession(`${actor.accountType}:${actor.organizationId}:${actor.id}`);
  return render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><UnsavedChangesProvider><SupplierEightDWorkspace supplierProblemId={id} portal={portal} onDenied={onDenied} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>);
}
beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org-1:sqe-1');
  actor = { accountType: 'INTERNAL', organizationId: 'org-1', id: 'sqe-1' };
  current = structuredClone(report); writes = []; failure = undefined;
  fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/auth/session') return json({ user: actor, securityState: 'AUTHENTICATED', landingPath: actor.accountType === 'INTERNAL' ? '/app/workbench' : '/supplier/inbox' });
    if (init.method && init.method !== 'GET') {
      const body = JSON.parse(String(init.body)); writes.push({ path, init, body });
      if (failure === 'network') throw new TypeError('network');
      if (failure) return json({ code: 'CONCURRENCY_CONFLICT', message: 'refused', fields: {} }, failure);
      current = { ...current, rowVersion: current.rowVersion + 1, ...(body.document ? { document: body.document } : {}) };
      return json(current);
    }
    if (path.includes('/revisions?')) return json({ items: [...new Set([current.submittedRevisionId, current.approvedRevisionId].filter(Boolean))].map((id, index) => ({ id, revision: index + 1, createdAt: '2026-10-28T00:00:00Z', approved: id === current.approvedRevisionId })), nextBefore: null });
    if (path.includes('deadline-extensions') || path.includes('/rounds')) return json([]);
    return json(current);
  });
  vi.stubGlobal('fetch', fetcher);
});

it.each([false, true])('loads the issued document and saves all D2-D8 to the correct portal=%s endpoint', async portal => {
  mount(portal);
  expect(await screen.findByDisplayValue('供应商实际问题')).toBeVisible();
  expect(screen.getByLabelText('D4 分析过程')).toBeVisible();
  expect(screen.getByLabelText('D8 结案总结')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '增加永久措施' }));
  fireEvent.change(screen.getByLabelText('措施 1 对策'), { target: { value: '真实对策' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe(`/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d/supplier-1`);
  expect(writes[0].body).toMatchObject({ expectedRowVersion: 4, expectedInstanceVersion: 2, document: { correctiveActions: [{ action: '真实对策' }] } });
});

it('requires explicit submission plan on analysis-complete and never invents a deadline', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '分析完成并设提交计划' }));
  const form = within(screen.getByRole('region', { name: '操作表单' }));
  expect(form.getByRole('button', { name: '确认提交' })).toBeDisabled();
  fireEvent.change(form.getByLabelText('完整提交计划'), { target: { value: '2026-11-10T12:00' } });
  fireEvent.click(form.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toMatch(/\/analysis-complete$/);
  expect(writes[0].body).toEqual({ expectedRowVersion: 4, expectedInstanceVersion: 2, submissionDueAt: new Date('2026-11-10T12:00').toISOString() });
});

it('locks in-review documents and never displays write actions absent from the GET', async () => {
  current.allowedActions = ['read']; current.status = 'IN_REVIEW';
  mount(); expect(await screen.findByLabelText('D2 问题描述')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '完整提交' })).not.toBeInTheDocument();
});

it('retains the complete draft on 409 and refreshes only the baseline explicitly', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: '本地保留草稿' } });
  failure = 409; fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '刷新基线并保留草稿' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(screen.getByLabelText('D2 问题描述')).toHaveValue('本地保留草稿');
});

it('freezes unknown writes, including the exact body and key, until explicit retry', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  failure = 'network'; fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  const retry = await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.getByLabelText('D2 问题描述')).toBeDisabled();
  failure = undefined; fireEvent.click(retry);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].init.body).toBe(writes[0].init.body);
  expect(writes[1].init.headers).toEqual(writes[0].init.headers);
});

it.each([401, 403])('clears sensitive state and aborts the scope on %s', async status => {
  const denied = vi.fn(); mount(false, 'supplier-1', denied); await screen.findByDisplayValue('供应商实际问题');
  failure = status; fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue('供应商实际问题')).not.toBeInTheDocument();
  expect(denied).toHaveBeenCalledTimes(1);
  expect((writes[0].init.signal as AbortSignal).aborted).toBe(true);
});

it('blocks refresh while there is an unknown write', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  failure = 'network'; fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.getByRole('button', { name: '刷新工作区' })).toBeDisabled();
});

it('protects unsaved edits on refresh and can keep editing', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: '未保存正文' } });
  fireEvent.click(screen.getByRole('button', { name: '刷新工作区' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('D2 问题描述')).toHaveValue('未保存正文');
});

it('aborts old identity reads on session replacement', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  const signal = fetcher.mock.calls.find(([path]) => String(path).includes('/eight-d/supplier-1'))![1].signal as AbortSignal;
  await act(async () => useWorkTabsStore.getState().bindSession('INTERNAL:org-2:other'));
  expect(signal.aborted).toBe(true);
});

it('resubmits the entire saved version after a returned closure round', async () => {
  current.closure = { id: 'round-old', problemId: 'problem-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', contentVersion: 5, roundNumber: 1, status: 'RETURNED', version: 3, duties: [], createdAt: '', updatedAt: '' };
  mount(); expect(await screen.findByLabelText('D2 问题描述')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '完整提交' }));
  fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toMatch(/\/submit$/);
  expect(writes[0].body).toEqual({ expectedRowVersion: 4, expectedInstanceVersion: 2 });
});

it('saves closed internal supplements only when explicitly allowed', async () => {
  current.closedAt = '2026-10-28T00:00:00Z'; current.allowedActions = ['read', 'supplement'];
  mount(); expect(await screen.findByLabelText('D8 结案总结')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('D8 结案总结'), { target: { value: '闭后内部补充' } });
  fireEvent.click(screen.getByRole('button', { name: '保存内部补充' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ document: { closureSummary: '闭后内部补充' } });
});

it('never enables private supplement, disclosure or internal approval in portal even with stray actions', async () => {
  current.closedAt = '2026-10-28T00:00:00Z'; current.allowedActions = ['read', 'supplement', 'disclosure-preview', 'release'];
  mount(true); expect(await screen.findByLabelText('D8 结案总结')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存内部补充' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '披露预览与释放' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '打开关闭职责待办' })).not.toBeInTheDocument();
});

it('requires disclosure preview then explicit confirmation, releasing the original selected list', async () => {
  current.allowedActions = ['read', 'disclosure-preview', 'release'];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.endsWith('/disclosure-preview')) {
      writes.push({ path, init, body: JSON.parse(String(init.body)) });
      return json({ previewToken: 'preview-1', supplierOrganizationId: 'vendor-1', supplierName: '供应商甲', rowVersion: 4, expiresAt: '2099-01-01T00:00:00Z', publicFacts: { title: '待外发事实', materialCode: 'MAT-1', defectDescription: '最小不良事实', defectQuantity: 1, severity: 'HIGH', reportNumber: 'SQ-001' }, selectedFileIds: [], attachments: [], warnings: ['自由文本须人工核对'] });
    }
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '披露预览与释放' }));
  expect(screen.queryByRole('button', { name: '确认释放给供应商' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '生成披露预览' }));
  expect(await screen.findByText('待外发事实')).toBeVisible();
  expect(screen.getByRole('button', { name: '确认释放给供应商' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对外发事实、目标供应商与所选附件' }));
  fireEvent.click(screen.getByRole('button', { name: '确认释放给供应商' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].body).toEqual({ expectedRowVersion: 4, selectedFileIds: [], previewToken: 'preview-1', confirmed: true });
  expect(writes[1].path).toMatch(/\/release$/);
});

it('requests a supplier-specific extension with all real optimistic versions', async () => {
  current.allowedActions.push('request-extension', 'deadline-extensions');
  mount(true); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '期限与延期' }));
  fireEvent.change(screen.getByLabelText('延期阶段'), { target: { value: 'SUBMISSION' } });
  fireEvent.change(screen.getByLabelText('申请到期时间'), { target: { value: '2026-11-12T15:00' } });
  fireEvent.change(screen.getByLabelText('延期理由'), { target: { value: '等待验证批次' } });
  fireEvent.click(screen.getByRole('button', { name: '提交延期申请' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe('/api/v1/supplier-portal/eight-d/supplier-1/deadline-extensions');
  expect(writes[0].body).toEqual({ expectedRowVersion: 4, expectedContentVersion: 6, expectedInstanceVersion: 2, stage: 'SUBMISSION', requestedDueAt: new Date('2026-11-12T15:00').toISOString(), reason: '等待验证批次' });
});

it('reads server-saved controlled reports and switches current, approved and known history', async () => {
  current.allowedActions.push('report'); current.approvedRevisionId = 'approved-1'; current.submittedRevisionId = 'submitted-2';
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/report?')) return json({ supplierProblemId: 'supplier-1', problemId: 'problem-1', reportNumber: 'SQ-001', view: 'CURRENT', revisionId: null, status: 'DRAFT', label: '服务端受控报告', contentVersion: 6, rowVersion: 4, generatedAt: '', attachments: [], snapshot: { document: { ...current.document, description: '服务端保存的报告正文' }, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 6, rowVersion: 4, ownerUserId: null, professionalUserId: 'sqe-1', responsibleSectionDepartmentId: 'section-1', collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null } });
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  expect(await screen.findByDisplayValue('服务端保存的报告正文')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).includes('view=APPROVED'))).toBe(true));
  await waitFor(() => expect(within(screen.getByLabelText('报告版本')).getAllByRole('option').some(option => (option as HTMLOptionElement).value === 'submitted-2')).toBe(true));
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'submitted-2' } });
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).includes('revisionId=submitted-2'))).toBe(true));
});

it.each([
  [false, false, 'supplier-quality'], [true, false, 'supplier-quality'], [false, true, 'supplier-eight-d-supplement'],
] as const)('uploads only CLEAN evidence to the correct resource portal=%s closed=%s', async (portal, closed, resourceType) => {
  vi.stubGlobal('crypto', webcrypto);
  if (closed) { current.closedAt = '2026-10-28T00:00:00Z'; current.allowedActions = ['read', 'supplement']; }
  let file: components['schemas']['FileDto'] = { id: 'file-1', resourceType, resourceId: 'supplier-1', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', scanReason: null, version: 1, uploadExpiresAt: '2099-01-01T00:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2099-01-01T00:00:00Z' };
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/files/uploads') return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} }, 201);
    if (path === 'https://objects.example.test/upload') return new Response(null);
    if (path === '/api/v1/files/file-1/complete') { file = { ...file, version: 2, scanStatus: 'PENDING' }; return json(file, 202); }
    if (path === '/api/v1/files/file-1') return json(file);
    return original(path, init);
  });
  mount(portal); await screen.findByDisplayValue('供应商实际问题');
  const summary = screen.getByText('D4 分析过程附件 (0)'); fireEvent.click(summary);
  const panel = within(summary.closest('details')!);
  const selected = new File(['sample'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  fireEvent.change(await panel.findByLabelText('选择附件'), { target: { files: [selected] } });
  await panel.findByText('等待安全扫描');
  expect(screen.getByRole('button', { name: closed ? '保存内部补充' : '保存草稿' })).toBeDisabled();
  if (!closed) expect(screen.getByRole('button', { name: '完整提交' })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await waitFor(() => expect(panel.getByRole('button', { name: '刷新附件' })).toBeEnabled());
  file = { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  fireEvent.click(panel.getByRole('button', { name: '刷新附件' }));
  await screen.findByText('D4 分析过程附件 (1)');
  await waitFor(() => expect(screen.getByRole('button', { name: closed ? '保存内部补充' : '保存草稿' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: closed ? '保存内部补充' : '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ document: { analysisFileIds: ['file-1'] } });
  const initialize = fetcher.mock.calls.find(([path]) => path === '/api/v1/files/uploads')!;
  expect(JSON.parse(initialize[1].body)).toMatchObject({ resourceType, resourceId: 'supplier-1' });
});

it('stages disclosure files separately and never releases PENDING files', async () => {
  vi.stubGlobal('crypto', webcrypto);
  current.allowedActions = ['read', 'disclosure-preview', 'release'];
  let file = { id: 'disclosure-file', resourceType: 'supplier-eight-d-disclosure', resourceId: 'supplier-1', originalName: 'public.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', version: 1 };
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/files/uploads') return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} }, 201);
    if (path === 'https://objects.example.test/upload') return new Response(null);
    if (path === '/api/v1/files/disclosure-file/complete') { file = { ...file, version: 2, scanStatus: 'PENDING' }; return json(file, 202); }
    if (path === '/api/v1/files/disclosure-file') return json(file);
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '披露预览与释放' }));
  const selected = new File(['sample'], 'public.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [selected] } });
  await screen.findByText('等待安全扫描');
  expect(screen.getByRole('button', { name: '生成披露预览' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '确认释放给供应商' })).not.toBeInTheDocument();
  const initialize = fetcher.mock.calls.find(([path]) => path === '/api/v1/files/uploads')!;
  expect(JSON.parse(initialize[1].body)).toMatchObject({ resourceType: 'supplier-eight-d-disclosure', resourceId: 'supplier-1' });
});

it.each([
  ['QUALITY_PENDING', ['approve-sqe', 'return-sqe'], 'SQE · 同意延期', 'SQE'],
  ['MANAGER_PENDING', ['approve-manager', 'return-manager'], '经理 · 同意延期', 'MANAGER'],
] as const)('uses server-supplied extension actions at %s without skipping duties', async (status, actions, button, duty) => {
  current.allowedActions = ['read', 'deadline-extensions'];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.endsWith('/deadline-extensions') && !init.method) return json([{ id: 'extension-1', supplierProblemId: 'supplier-1', severity: 'HIGH', stage: 'CLOSURE', status, originalDueAt: '2026-10-27T00:00:00Z', requestedDueAt: '2026-11-10T00:00:00Z', originallyOverdue: true, reason: '真实延期', version: 3, createdAt: '', allowedActions: actions }]);
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '期限与延期' }));
  const approve = await screen.findByRole('button', { name: button }); expect(approve).toBeDisabled();
  const otherDuty = duty === 'SQE' ? '经理 · 同意延期' : 'SQE · 同意延期';
  expect(screen.queryByRole('button', { name: otherDuty })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('延期处理意见'), { target: { value: '核对后同意' } });
  fireEvent.click(approve); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe('/api/v1/supplier-quality/eight-d/supplier-1/deadline-extensions/extension-1/decide');
  expect(writes[0].body).toEqual({ expectedVersion: 3, duty, decision: 'APPROVE', comment: '核对后同意' });
});

it('does not infer extension approval eligibility from HIGH risk and pending status', async () => {
  current.allowedActions = ['read', 'deadline-extensions'];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => path.endsWith('/deadline-extensions') && !init.method ? json([{ id: 'extension-1', severity: 'HIGH', stage: 'CLOSURE', status: 'QUALITY_PENDING', originalDueAt: '', requestedDueAt: '', reason: '真实延期', version: 3 }]) : original(path, init));
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '期限与延期' }));
  await screen.findByText('真实延期');
  expect(screen.queryByRole('button', { name: /同意延期|退回延期|取消延期申请/ })).not.toBeInTheDocument();
});

it.each([
  { portal: false, action: 'return-sqe', duty: 'SQE', label: 'SQE · 退回延期' },
  { portal: false, action: 'return-manager', duty: 'MANAGER', label: '经理 · 退回延期' },
  { portal: true, action: 'cancel', duty: undefined, label: '取消延期申请' },
] as const)('dispatches only the server-authorized extension $action with the original request version', async ({ portal, action, duty, label }) => {
  current.allowedActions = ['read', 'deadline-extensions'];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.endsWith('/deadline-extensions') && !init.method) return json([{ id: 'extension-1', supplierProblemId: 'supplier-1', severity: 'HIGH', stage: 'CLOSURE', status: duty === 'MANAGER' ? 'MANAGER_PENDING' : 'QUALITY_PENDING', originalDueAt: '', requestedDueAt: '', originallyOverdue: false, reason: '真实延期', version: 3, createdAt: '', allowedActions: portal ? [action, 'approve-sqe'] : [action] }]);
    return original(path, init);
  });
  mount(portal); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '期限与延期' }));
  const button = await screen.findByRole('button', { name: label }); expect(button).toBeDisabled();
  if (portal) expect(screen.queryByRole('button', { name: /同意延期|退回延期/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('延期处理意见'), { target: { value: '核对后退回或撤销' } });
  fireEvent.click(button); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe(`/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d/supplier-1/deadline-extensions/extension-1/${duty ? 'decide' : 'cancel'}`);
  expect(writes[0].body).toEqual({ expectedVersion: 3, comment: '核对后退回或撤销', ...(duty ? { duty, decision: 'RETURN' } : {}) });
});

it.each([1440, 375])('keeps the complete editable document reachable at simulated %spx (not browser geometry)', async width => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  for (const name of ['D2 问题描述', 'D4 分析过程', '发生因', '流出因', 'D8 结案总结']) expect(screen.getByLabelText(name)).toBeEnabled();
  for (const name of ['增加临时措施', '增加永久措施', '增加横向展开', '增加标准化文件']) expect(screen.getByRole('button', { name })).toBeEnabled();
});

function savedReport(): components['schemas']['SupplierEightDControlledReportDto'] {
  return { supplierProblemId: 'supplier-1', problemId: 'problem-1', reportNumber: 'SQ-001', view: 'CURRENT', revisionId: null, status: 'DRAFT', label: '受控保存版', contentVersion: 6, rowVersion: 4, generatedAt: '', attachments: [], snapshot: { document: current.document, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 6, rowVersion: 4, ownerUserId: null, professionalUserId: 'sqe-1', responsibleSectionDepartmentId: 'section-1', collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null } };
}

it.each([false, true])('enumerates and keyset-pages real historical revisions for portal=%s without guessing IDs', async portal => {
  current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/revisions?')) {
      const query = new URL(path, 'http://localhost').searchParams;
      expect(query.get('pageSize')).toBe('20'); expect(query.has('organizationId')).toBe(false);
      return json(query.has('before') ? { items: [{ id: 'historical-1', revision: 1, createdAt: '2026-10-01T00:00:00Z', approved: false }], nextBefore: null } : { items: [{ id: 'historical-21', revision: 21, createdAt: '2026-10-27T00:00:00Z', approved: true }], nextBefore: 21 });
    }
    if (path.includes('/report?')) return json(savedReport());
    return original(path, init);
  });
  mount(portal); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  const selector = screen.getByLabelText('报告版本');
  await waitFor(() => expect(within(selector).getByRole('option', { name: /历史修订.*21/ })).toHaveValue('historical-21'));
  fireEvent.click(screen.getByRole('button', { name: '加载更多历史版本' }));
  await waitFor(() => expect(within(selector).getByRole('option', { name: /^历史修订 · 1 ·/ })).toHaveValue('historical-1'));
  expect(within(selector).getAllByRole('option')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: '加载更多历史版本' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/revisions?pageSize=20&before=21'))).toBe(true);
  fireEvent.change(selector, { target: { value: 'historical-1' } });
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).includes('/report?revisionId=historical-1'))).toBe(true));
});

it('preserves already enumerated history on a failed next page and retries the same keyset cursor', async () => {
  current.allowedActions.push('report'); let fail = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/revisions?')) return path.includes('before=21') ? fail ? json({ code: 'INTERNAL_ERROR', message: 'unavailable' }, 503) : json({ items: [{ id: 'older-1', revision: 1, createdAt: '', approved: false }], nextBefore: null }) : json({ items: [{ id: 'recent-21', revision: 21, createdAt: '', approved: false }], nextBefore: 21 });
    if (path.includes('/report?')) return json(savedReport());
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多历史版本' }));
  const retry = await screen.findByRole('button', { name: '重试历史版本' });
  expect(within(screen.getByLabelText('报告版本')).getByRole('option', { name: /历史修订.*21/ })).toHaveValue('recent-21');
  fail = false; fireEvent.click(retry);
  await waitFor(() => expect(within(screen.getByLabelText('报告版本')).getByRole('option', { name: /^历史修订 · 1 ·/ })).toHaveValue('older-1'));
  expect(fetcher.mock.calls.filter(([path]) => String(path).includes('/revisions?pageSize=20&before=21'))).toHaveLength(2);
});

it('clears all sensitive content when permission is revoked while paging historical revisions', async () => {
  current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/revisions?')) return path.includes('before=21') ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'revoked' }, 403) : json({ items: [{ id: 'recent-21', revision: 21, createdAt: '', approved: false }], nextBefore: 21 });
    if (path.includes('/report?')) return json(savedReport());
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多历史版本' }));
  await screen.findByText(/敏感内容已清除/); expect(screen.queryByRole('option', { name: /历史修订/ })).not.toBeInTheDocument();
});

it('aborts a dismissed history page and ignores its late response after reopening the report', async () => {
  current.allowedActions.push('report'); let release!: (response: Response) => void; let signal!: AbortSignal;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/revisions?')) {
      if (path.includes('before=21')) { signal = init.signal as AbortSignal; return new Promise<Response>(resolve => { release = resolve; }); }
      return json({ items: [{ id: 'recent-21', revision: 21, createdAt: '', approved: false }], nextBefore: 21 });
    }
    if (path.includes('/report?')) return json(savedReport());
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多历史版本' })); await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '取消操作' })); expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  await waitFor(() => expect(within(screen.getByLabelText('报告版本')).getByRole('option', { name: /历史修订.*21/ })).toHaveValue('recent-21'));
  await act(async () => release(json({ items: [{ id: 'late-private', revision: 1, createdAt: '不应回填', approved: false }], nextBefore: null })));
  expect(screen.queryByRole('option', { name: /不应回填/ })).not.toBeInTheDocument();
});

it('rehydrates a new row baseline without keeping a hidden historical selection from the old page', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/revisions?')) return json({ items: [{ id: current.rowVersion === 4 ? 'old-history' : 'new-history', revision: current.rowVersion, createdAt: '', approved: false }], nextBefore: null });
    if (path.includes('/report?')) return json(savedReport());
    return original(path, init);
  });
  const view = () => <LanguageProvider><SupplierControlledReport report={current} base="/api/v1/supplier-quality/eight-d/supplier-1" portal={false} read={apiRequest} /></LanguageProvider>;
  const mounted = render(view());
  await waitFor(() => expect(within(screen.getByLabelText('报告版本')).getByRole('option', { name: /历史修订/ })).toHaveValue('old-history'));
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'old-history' } });
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).includes('revisionId=old-history'))).toBe(true));
  current = { ...current, rowVersion: 5 }; mounted.rerender(view());
  await waitFor(() => expect(within(screen.getByLabelText('报告版本')).getByRole('option', { name: /历史修订/ })).toHaveValue('new-history'));
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => String(path).includes('/report?')).at(-1)![0]).toContain('view=CURRENT'));
  expect(screen.getByLabelText('报告版本')).toHaveValue('CURRENT');
});

it('omits the internal owner organization from portal report and PDF queries for a different vendor principal', async () => {
  current.organizationId = 'internal-owner-org'; current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/report?') || path.includes('/report/pdf?')) {
      const organizationId = new URL(path, 'http://localhost').searchParams.get('organizationId');
      if (organizationId && organizationId !== actor.organizationId) return json({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'query must match the actual vendor principal' }, 403);
      return path.includes('/report/pdf?') ? new Response('%PDF-1.7\nportal report', { headers: { 'content-type': 'application/pdf' } }) : json(savedReport());
    }
    return original(path, init);
  });
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:portal-report'); URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    mount(true); expect(actor.organizationId).not.toBe(current.organizationId);
    await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
    await screen.findByText('受控保存版');
    fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const paths = fetcher.mock.calls.map(([path]) => String(path)).filter(path => path.includes('/report?') || path.includes('/report/pdf?'));
    expect(paths).toHaveLength(2);
    paths.forEach(path => { expect(path).toContain('/supplier-portal/eight-d/supplier-1/report'); expect(new URL(path, 'http://localhost').searchParams.has('organizationId')).toBe(false); });
  } finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; click.mockRestore(); }
});

it.each([200, 401, 403, 500])('authorizes and validates binary PDF downloads (HTTP %s)', async status => {
  current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/report?')) return json(savedReport());
    if (path.includes('/report/pdf?')) return new Response(status === 200 ? '%PDF-1.7\ncontrolled' : 'refused', { status, headers: { 'content-type': status === 200 ? 'application/pdf' : 'text/plain' } });
    return original(path, init);
  });
  const create = vi.fn(() => 'blob:report'), revoke = vi.fn();
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
    const button = await screen.findByRole('button', { name: '授权下载 PDF' });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path).includes('/report/pdf?'))).toBe(true));
    if (status === 200) { await waitFor(() => expect(create).toHaveBeenCalledTimes(1)); expect(revoke).toHaveBeenCalledWith('blob:report'); expect(click).toHaveBeenCalledTimes(1); }
    else if ([401, 403].includes(status)) { await screen.findByText(/敏感内容已清除/); expect(create).not.toHaveBeenCalled(); }
    else { await screen.findByText(/报告读取或下载失败/); expect(create).not.toHaveBeenCalled(); }
  } finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; click.mockRestore(); }
});

it('does not publish a fake PDF when the response is JSON or has invalid bytes', async () => {
  current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes('/report?')) return json(savedReport());
    if (path.includes('/report/pdf?')) return new Response('not pdf', { headers: { 'content-type': 'application/pdf' } });
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  const button = await screen.findByRole('button', { name: '授权下载 PDF' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  await screen.findByText(/报告读取或下载失败/);
});

it('clears the scope rather than rehydrating a write receipt from another organization', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  current.organizationId = 'other-org'; current.document.description = '其他组织敏感正文';
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue('其他组织敏感正文')).not.toBeInTheDocument();
});

it('shows business status and risk labels instead of internal codes', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  const header = within(screen.getByRole('heading', { name: 'SQ-001' }).closest('header')!);
  expect(header.getByText('办理中')).toBeVisible(); expect(header.getByText('高风险')).toBeVisible();
});

it('never renders a portal private supplement even if a report response is accidentally misprojected', async () => {
  current.allowedActions.push('report');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => path.includes('/report?') ? json({ ...savedReport(), status: 'CLOSED_SUPPLEMENT', snapshot: { ...savedReport().snapshot, document: { ...current.document, description: '不应对外的补充' } } }) : original(path, init));
  mount(true); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '受控报告与历史' }));
  await screen.findByText(/敏感内容已清除/); expect(screen.queryByDisplayValue('不应对外的补充')).not.toBeInTheDocument();
});

it('checks the actual portal account type before dispatching and does not impersonate INTERNAL', async () => {
  mount(true); await screen.findByDisplayValue('供应商实际问题');
  actor = { accountType: 'INTERNAL', organizationId: 'org-1', id: 'sqe-1' };
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/敏感内容已清除/); expect(writes).toHaveLength(0);
});

it('clears the whole workspace and aborts sensitive requests when the shared closure inbox loses access', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.startsWith('/api/v1/tasks/closure?')) return json({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
    if (path.startsWith('/api/v1/notifications/closure?')) return json({ items: [], total: 0 });
    return original(path, init);
  });
  const denied = vi.fn(); mount(false, 'supplier-1', denied); await screen.findByDisplayValue('供应商实际问题');
  const signal = fetcher.mock.calls.find(([path]) => path === '/api/v1/supplier-quality/eight-d/supplier-1')![1].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '打开关闭职责待办' }));
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue('供应商实际问题')).not.toBeInTheDocument();
  expect(denied).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
});

it('does not dispatch when the actual principal changes during CSRF preparation', async () => {
  let release!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === '/api/v1/auth/csrf' ? new Promise<Response>(resolve => { release = resolve; }) : original(path, init));
  mount(); await screen.findByDisplayValue('供应商实际问题'); fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  actor = { accountType: 'INTERNAL', organizationId: 'org-1', id: 'replacement' };
  await act(async () => release(json({ csrfToken: 'late-token' })));
  await screen.findByText(/敏感内容已清除/); expect(writes).toHaveLength(0);
});

it('preserves optional rows as optional instead of inserting suggested containment into saved content', async () => {
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ document: { containment: [], optionalAffectedContainment: [], okFileIds: [], ngFileIds: [], analysisFileIds: [], systemCause: '' } });
});

it.each(['PROFESSIONAL', 'JOINT'] as const)('reuses the real closure inbox with explicit %s duty decisions', async kind => {
  const duties: components['schemas']['WorkflowClosureRoundDto']['duties'] = (kind === 'JOINT' ? ['SECTION_MANAGER', 'MINISTER'] as const : ['PROFESSIONAL'] as const).map((duty, index) => ({ id: `duty-${index}`, duty, userId: 'sqe-1', status: 'PENDING', version: 1, decidedBy: null, comment: null, decidedAt: null }));
  const round: components['schemas']['WorkflowClosureRoundDto'] = { id: 'round-1', problemId: 'problem-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', contentVersion: 6, roundNumber: 1, version: 3, status: 'PENDING', createdAt: '', updatedAt: '', duties };
  current.closure = round; current.status = 'IN_REVIEW'; current.allowedActions = ['read'];
  const task: components['schemas']['ClosureTaskDto'] = { id: 'task-1', roundId: round.id, roundVersion: 3, problemId: 'problem-1', reportNumber: 'SQ-001', workflowVersionId: 'flow-1', duty: duties[0].duty, status: 'PENDING', contentVersion: 6, createdAt: '', userId: 'sqe-1', canAct: true, requiresJointConfirmation: kind === 'JOINT', jointDuties: kind === 'JOINT' ? ['SECTION_MANAGER', 'MINISTER'] : [] };
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.startsWith('/api/v1/tasks/closure?')) return json({ items: [task], total: 1 });
    if (path.startsWith('/api/v1/notifications/closure?')) return json({ items: [], total: 0 });
    if (path.endsWith('/rounds')) return json([round]);
    if (path.endsWith('/round-1/decide')) { writes.push({ path, init, body: JSON.parse(String(init.body)) }); return json({ ...round, version: 4, status: 'APPROVED' }); }
    return original(path, init);
  });
  mount(); await screen.findByDisplayValue('供应商实际问题');
  fireEvent.click(screen.getByRole('button', { name: '打开关闭职责待办' }));
  const review = await screen.findByRole('button', { name: '审核关闭职责' }); await waitFor(() => expect(review).toBeEnabled()); fireEvent.click(review);
  const dialog = within(await screen.findByRole('dialog', { name: '关闭职责审核' }));
  await dialog.findByText('固定内容版本：6');
  fireEvent.change(dialog.getByLabelText('审核意见'), { target: { value: '核对完整受控版本后同意' } });
  const submit = dialog.getByText('提交审核', { selector: 'button span' }).closest('button')!;
  if (kind === 'JOINT') { expect(submit).toBeDisabled(); fireEvent.click(dialog.getByLabelText('我确认同时审核科室经理与部长两份职责')); }
  fireEvent.click(submit); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ expectedRoundVersion: 3, duties: duties.map(item => item.duty), decision: 'APPROVE', comment: '核对完整受控版本后同意' });
});
