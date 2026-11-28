import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessEightDWorkspace } from './ProcessEightDWorkspace';

vi.setConfig({ testTimeout: 45000 });

type Report = components['schemas']['ProcessEightDReportDto'];
const document: Report['document'] = {
  description: '真实过程问题', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [],
  standardization: Array.from({ length: 11 }, (_, index) => ({ id: `preset-${index}`, key: `document-${index}`, documentName: `受控文件 ${index + 1}`, needsUpdate: null, departmentOwner: '', plannedAt: null, completedAt: null, status: '', reason: '' })), closureSummary: '',
};
const report: Report = {
  problemId: 'problem-1', reportNumber: '8D-001', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', instanceVersion: 3, problemVersion: 2,
  version: 7, contentVersion: 4, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner-1', professionalUserId: 'quality-1', responsibleSectionDepartmentId: 'section-1',
  collaboratorUserIds: [], document, analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null,
  allowedActions: ['read', 'save', 'submit', 'collaborators', 'reassign', 'risk', 'sources', 'deadlines', 'request-extension'], sources: [], revisions: [],
};
let current: Report;
let writes: { path: string; init: RequestInit; body: Record<string, unknown> }[];
let failWrite: number | 'network' | undefined;
let fetcher: ReturnType<typeof vi.fn>;
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function intercept(handler: (path: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => handler(path, init) ?? previous(path, init));
}
const defect: components['schemas']['ProcessDefectDto'] = {
  dispositionPlan: null, dispositionProgress: null, dispositionCompletedAt: null, dispositionHistory: [],
  id: 'defect-1', organizationId: 'org-1', defectTypeCode: null, description: '台账真实划伤', defectQuantity: null, occurredAt: null, traceCode: 'BAR-01', analysisProgress: null,
  ledgerStatus: 'FOLLOWING', closedById: null, closedAt: null, responsibilityCategory: null, sourceKind: 'MANUAL', version: 6,
  materials: [], materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [], componentProject: null, duplicateCount: 0, issues: [],
  lineName: null, operationName: null, shift: null, factoryCode: null, operationSector: null, productCategory: null, productSubcategory: null, projectStage: null, projectName: null, pendingCompletion: false, pendingConfiguration: false, registrationIssues: [], registeredByName: null,
};
function controlled(view: 'CURRENT' | 'APPROVED' | 'HISTORICAL'): components['schemas']['ProcessEightDControlledReportDto'] {
  return { problemId: report.problemId, reportNumber: report.reportNumber, view, revisionId: view === 'CURRENT' ? null : 'revision-1', status: view === 'CURRENT' ? 'DRAFT' : view === 'APPROVED' ? 'APPROVED' : 'HISTORICAL', label: `${view} 服务端版本`, contentVersion: 4, rowVersion: 7, generatedAt: '2026-10-25T10:00:00Z', attachments: [], previewFingerprint: 'a'.repeat(64),
    snapshot: { document: { ...document, description: `${view} 已保存内容` }, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 4, rowVersion: 7, ownerUserId: report.ownerUserId, professionalUserId: report.professionalUserId, responsibleSectionDepartmentId: report.responsibleSectionDepartmentId, collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null } };
}
function mount(id = 'problem-1', title?: string) {
  return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessEightDWorkspace problemId={id} title={title} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}
const actions = (name: string | RegExp = '办理操作') => within(screen.getByLabelText(name, { selector: '[role="group"]' }));
const chapters = () => within(screen.getByLabelText('8D 内容分区', { selector: 'nav' }));
const analysisPanel = () => within(screen.getByRole('heading', { name: /^D4 ·/ }).closest('section')!.querySelector<HTMLElement>('.attachment-panel')!);
async function openPlans() {
  fireEvent.click(screen.getByRole('button', { name: '责任与计划' }));
  const dialog = await screen.findByRole('dialog', { name: '责任与计划' });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}
function openOptionalContainment() {
  const summary = screen.getByText('潜在影响围堵（可选）', { selector: 'summary' });
  expect(summary.parentElement).not.toHaveAttribute('open');
  fireEvent.click(summary);
  return screen.getByRole('region', { name: '潜在影响围堵' });
}
async function openMore(label = '更多') {
  fireEvent.click(actions(/^(办理操作|Workflow actions)$/).getByRole('button', { name: label }));
  return within(await screen.findByRole('menu'));
}
async function chooseMore(name: string, label?: string) {
  fireEvent.click((await openMore(label)).getByRole('menuitem', { name }));
}
beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:owner-1:org-1');
  current = structuredClone(report); writes = []; failWrite = undefined;
  fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return response({ csrfToken: 'csrf' });
    if (path.endsWith('/closure-check') && init.method === 'POST') return response([]);
    if (init.method && init.method !== 'GET') {
      writes.push({ path, init, body: JSON.parse(String(init.body)) });
      if (failWrite === 'network') throw new TypeError('Failed to fetch');
      if (typeof failWrite === 'number') return response({ code: 'CONCURRENCY_CONFLICT', message: 'refused', fields: {} }, failWrite);
      const body = JSON.parse(String(init.body));
      current = { ...current, version: current.version + 1, ...(body.document ? { document: body.document } : {}) };
      return response(current);
    }
    if (path.includes('/rounds') || path.includes('/requests')) return response([]);
    if (path.includes('/assignment-options')) return response({ departments: [{ id: 'section-1', code: 'S1', name: '科室一' }], users: [{ id: 'owner-2', username: 'user2', fullName: '候选负责人' }], departmentTotal: 1, userTotal: 1, page: 1, pageSize: 20 });
    if (path.includes('/defects?')) return response({ items: [], total: 0, page: 1, pageSize: 20 });
    if (path.includes('/audit-trail')) return response({ items: [], nextCursor: null, domainRevisionTrailAvailable: true });
    return response(current);
  });
  vi.stubGlobal('fetch', fetcher);
});

it('loads the real report and shows one active chapter', async () => {
  mount();
  expect(await screen.findByDisplayValue('真实过程问题')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^D4 ·/ }));
  expect(screen.getByRole('button', { name: /^D4 ·/ })).toHaveAttribute('aria-current', 'step');
  expect(screen.getByLabelText('分析过程描述')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^D7 ·/ }));
  expect(screen.getByText('受控文件 11')).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/v1/process-quality/eight-d/problem-1'), expect.objectContaining({ credentials: 'include' }));
});

it('groups process header actions by node and keeps the responsibility summary separate', async () => {
  current.allowedActions = ['read', 'save', 'analysis-complete', 'reassign', 'risk', 'sources', 'deadlines', 'request-extension'];
  current.currentNodeName = '原因分析';
  current.ownerName = '工艺负责人';
  current.responsibleSectionName = '制程质量科';
  mount('problem-1', '组装划伤');
  const description = await screen.findByDisplayValue('真实过程问题');
  const header = within(screen.getByRole('heading', { name: '组装划伤' }).closest('header')!);
  expect(screen.getAllByText('8D-001')).toHaveLength(1);
  expect(header.queryByText('原因分析')).not.toBeInTheDocument();
  expect(header.getByRole('button', { name: '刷新工作区' })).toBeVisible();
  expect(header.getByRole('button', { name: '流程日志' })).toBeVisible();
  const actions = within(header.getByRole('group', { name: '办理操作' }));
  expect(actions.getAllByRole('button').map(button => button.textContent)).toEqual(['确认分析完成', '保存草稿', '更多']);
  const summary = await openPlans();
  expect(summary.getByText('原因分析')).toBeVisible();
  expect(summary.getByText('工艺负责人')).toBeVisible();
  expect(summary.getByText('制程质量科')).toBeVisible();
  const closePlans = summary.getByRole('button', { name: '关闭' });
  expect(summary.getAllByRole('button')).toEqual([closePlans]);
  expect(screen.queryByText(/owner-1|section-1|内容版本|记录版本/)).not.toBeInTheDocument();
  fireEvent.click(closePlans);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  fireEvent.click(actions.getByRole('button', { name: '更多' }));
  const menu = within(await screen.findByRole('menu'));
  expect(menu.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['专业重派 / 科室内转派', '调整风险', '调整来源', '设置期限', '申请延期']);
  fireEvent.change(description, { target: { value: '未保存的说明' } });
  expect(actions.getByRole('button', { name: '确认分析完成' })).toBeDisabled();
  expect(actions.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  expect(menu.getByRole('menuitem', { name: '调整风险' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(menu.getByRole('menuitem', { name: '调整风险' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each(['8D-001', ' 8D-001 '])('renders only one report number when the process title is %j', async title => {
  mount('problem-1', title);
  await screen.findByDisplayValue('真实过程问题');
  const header = within(screen.getByRole('heading', { name: '8D-001' }).closest('header')!);
  expect(header.getAllByText('8D-001')).toHaveLength(1);
});

it('shows the process record with time, person and content without requesting audit access', async () => {
  const occurredAt = '2026-11-26T02:00:00.000Z';
  intercept(path => path.endsWith('/flow-records?organizationId=org-1') ? response([
    { occurredAt, person: '系统', content: '原分管任职已失效，改派直属上级主负责人' },
    { occurredAt, person: '质量负责人', content: '管理审核通过' },
  ]) : undefined);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '流程日志' }));
  const table = within(await screen.findByRole('table', { name: '流程记录' }));
  expect(table.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['时间', '人员', '内容']);
  const fallback = await table.findByRole('row', { name: /原分管任职已失效，改派直属上级主负责人/ });
  await waitFor(() => expect(within(fallback).getByText('系统')).toBeVisible());
  expect(fallback.querySelector('time')).toHaveAttribute('datetime', occurredAt);
  expect(table.getByRole('row', { name: /质量负责人.*管理审核通过/ })).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/audit-trail'))).toBe(false);
});

it('keeps the process draft when retrying a failed flow log request', async () => {
  let failFlowLog = true;
  intercept(path => {
    if (!path.includes('/flow-records?')) return undefined;
    return failFlowLog ? response({ message: 'unavailable' }, 500)
      : response([{ occurredAt: '2026-11-26T02:00:00.000Z', person: '系统', content: '管理审核已记录' }]);
  });
  mount();
  fireEvent.change(await screen.findByDisplayValue('真实过程问题'), { target: { value: '制程未保存正文' } });
  fireEvent.click(screen.getByRole('button', { name: '流程日志' }));
  const dialog = within(await screen.findByRole('dialog', { name: '流程日志' }));
  await waitFor(() => expect(dialog.getByText('流程记录加载失败')).toBeVisible());
  expect(screen.getByDisplayValue('制程未保存正文')).toBeInTheDocument();
  failFlowLog = false;
  fireEvent.click(dialog.getByRole('button', { name: /^重\s*试$/ }));
  expect(await dialog.findByText('管理审核已记录')).toBeVisible();
  expect(screen.getByDisplayValue('制程未保存正文')).toBeInTheDocument();
});

it('clears the process draft when workspace access is revoked while loading the flow log', async () => {
  intercept(path => path.includes('/flow-records?')
    ? response({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403) : undefined);
  mount();
  fireEvent.change(await screen.findByDisplayValue('真实过程问题'), { target: { value: '制程未保存正文' } });
  fireEvent.click(screen.getByRole('button', { name: '流程日志' }));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(screen.queryByDisplayValue('制程未保存正文')).not.toBeInTheDocument();
});

it('shows CRITICAL as 重大风险 in the header and full risk options without changing payload codes', async () => {
  current.severity = 'CRITICAL';
  mount(); await screen.findByDisplayValue('真实过程问题');
  const header = within(screen.getByRole('heading', { name: '8D-001' }).closest('header')!);
  expect(header.getByText('重大风险')).toBeVisible();
  expect(header.getByText('办理中')).toBeVisible();
  expect(header.queryByText('CRITICAL')).not.toBeInTheDocument();
  expect(header.queryByText('PROCESSING')).not.toBeInTheDocument();
  await chooseMore('调整风险');
  const dialog = within(await screen.findByRole('dialog'));
  const options = dialog.getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['低风险', '中风险', '高风险', '重大风险']);
  expect(options.map(option => (option as HTMLOptionElement).value)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  expect(dialog.getByLabelText('风险等级')).toHaveValue('CRITICAL');
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '确认重大风险事实' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ organizationId: 'org-1', expectedVersion: 7, severity: 'CRITICAL', reason: '确认重大风险事实', confirmCancelApproval: false });
});

it.each([
  ['IN_REVIEW', 'HIGH', '审批中', '高风险'],
  ['CLOSED', 'MEDIUM', '已关闭', '中风险'],
  ['FUTURE_STATUS', 'LOW', 'FUTURE_STATUS', '低风险'],
] as const)('shows header status %s and risk %s without guessing unknown status mappings', async (status, severity, statusLabel, riskLabel) => {
  current.status = status; current.severity = severity;
  mount(); await screen.findByDisplayValue('真实过程问题');
  const header = within(screen.getByRole('heading', { name: '8D-001' }).closest('header')!);
  expect(header.getByText(statusLabel)).toBeVisible();
  expect(header.getByText(riskLabel)).toBeVisible();
});

it('preserves English locale for header and risk option labels', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US'); current.severity = 'CRITICAL';
  mount(); await screen.findByDisplayValue('真实过程问题');
  const header = within(screen.getByRole('heading', { name: '8D-001' }).closest('header')!);
  expect(header.getByText('Processing')).toBeVisible();
  expect(header.getByText('Critical risk')).toBeVisible();
  await chooseMore('Change risk', 'More');
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getAllByRole('option').map(option => option.textContent)).toEqual(['Low risk', 'Medium risk', 'High risk', 'Critical risk']);
});

it('saves incomplete drafts with CAS, CSRF and idempotency, without inventing evidence', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '分析尚在进行' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ expectedVersion: 7, organizationId: 'org-1', document: { analysisProcess: '分析尚在进行', analysisFileIds: [], systemCause: '' } });
  expect(writes[0].init.headers).toMatchObject({ 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) });
});

it('retains the draft on conflict and refreshes its baseline only explicitly', async () => {
  failWrite = 409; mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '本地分析' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/版本冲突/);
  expect(screen.getByLabelText('分析过程描述')).toHaveValue('本地分析');
  current.version = 9;
  fireEvent.click(screen.getByRole('button', { name: '刷新基线并保留草稿' }));
  await waitFor(() => expect(actions().getByRole('button', { name: '保存草稿' })).toBeEnabled());
  expect(screen.getByLabelText('分析过程描述')).toHaveValue('本地分析');
  failWrite = undefined; fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].body.expectedVersion).toBe(9);
});

it('freezes unknown writes and retries the identical body and key', async () => {
  failWrite = 'network'; mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '未知回执草稿' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/写入结果未知/);
  expect(screen.getByLabelText('分析过程描述')).toBeDisabled();
  failWrite = undefined; fireEvent.click(screen.getByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].body).toEqual(writes[0].body);
  expect(writes[1].init.headers).toEqual(writes[0].init.headers);
});

it.each([{ stage: 'CSRF', status: 429 }, { stage: 'PUT', status: 400 }, { stage: 'PUT', status: 422 }, { stage: 'PUT', status: 429 }])('retains an unknown workspace action after retry $stage $status until the original request succeeds', async ({ stage, status }) => {
  failWrite = 'network'; mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('调整风险');
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '原风险理由' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认提交' }));
  await dialog.findByText(/写入结果未知/);
  expect(dialog.getByLabelText('变更 / 申请理由')).toBeDisabled();
  let rejectCsrf = stage === 'CSRF';
  intercept(path => path === '/api/v1/auth/csrf' && rejectCsrf ? response({ code: 'HTTP_429', message: 'refused' }, 429) : undefined);
  failWrite = status;
  await act(async () => { fireEvent.click(dialog.getByRole('button', { name: '重试原请求' })); });
  expect(dialog.getByLabelText('变更 / 申请理由')).toBeDisabled();
  expect(dialog.getByLabelText('变更 / 申请理由')).toHaveValue('原风险理由');
  expect(dialog.getByRole('button', { name: '确认提交' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '重试原请求' })).toBeEnabled();
  expect(writes).toHaveLength(stage === 'CSRF' ? 1 : 2);
  rejectCsrf = false; failWrite = undefined;
  fireEvent.click(dialog.getByRole('button', { name: '重试原请求' }));
  await screen.findByText('服务端已确认保存 / 操作成功。');
  expect(writes).toHaveLength(stage === 'CSRF' ? 2 : 3);
  for (const write of writes.slice(1)) {
    expect(write.path).toBe(writes[0].path);
    expect(write.init.method).toBe('PUT');
    expect(write.init.body).toBe(writes[0].init.body);
    expect(write.init.headers).toEqual(writes[0].init.headers);
  }
  expect((await openMore()).getByRole('menuitem', { name: '调整风险' })).not.toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByText(/写入结果未知/)).not.toBeInTheDocument();
});

it.each([400, 422, 429])('keeps workspace action inputs editable after initial explicit %s rejection', async status => {
  intercept((path, init) => path.endsWith('/risk') && init.method === 'PUT' ? response({ code: `HTTP_${status}`, message: 'refused' }, status) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('调整风险');
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '应保留的风险理由' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认提交' }));
  await dialog.findByText('操作未通过，请核对缺项、资格与服务端返回的字段。');
  expect(dialog.getByLabelText('变更 / 申请理由')).toBeEnabled();
  expect(dialog.getByLabelText('变更 / 申请理由')).toHaveValue('应保留的风险理由');
  expect(dialog.getByRole('button', { name: '确认提交' })).toBeEnabled();
  expect(dialog.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
});

it.each([401, 403])('clears sensitive content on %s and does not retain the draft', async status => {
  failWrite = status; mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '敏感分析' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(screen.queryByDisplayValue('敏感分析')).not.toBeInTheDocument();
  expect(screen.queryByText('8D-001')).not.toBeInTheDocument();
});

it('uses allowedActions rather than role names and cannot submit as a collaborator', async () => {
  current.allowedActions = ['read', 'save']; mount(); await screen.findByDisplayValue('真实过程问题');
  expect(actions().getByRole('button', { name: '保存草稿' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '完整提交' })).not.toBeInTheDocument();
  expect(actions().queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
});

it('renders review and closed documents read-only without manufacturing scan results', async () => {
  current.allowedActions = ['read', 'sources']; current.status = 'CLOSED'; current.closedRevisionId = 'revision-1'; mount();
  await screen.findByDisplayValue('真实过程问题');
  expect(screen.getByLabelText('分析过程描述')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
  expect(screen.getByText(/批准版不随关闭后来源补充改变/)).toBeVisible();
});

it('cancels risk change confirmation without writing anything', async () => {
  current.allowedActions = ['read', 'risk']; current.status = 'IN_REVIEW'; mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('调整风险');
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));
  expect(writes).toHaveLength(0);
});

it('does not accept a late report after session scope changed', async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { release ??= resolve; }));
  mount();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => { useWorkTabsStore.getState().bindSession('INTERNAL:other:org-2'); release(response(report)); });
  await waitFor(() => expect(screen.queryByDisplayValue('真实过程问题')).not.toBeInTheDocument());
});

it('offers original-key retry inside a frozen action dialog, not behind its mask', async () => {
  failWrite = 'network'; mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('调整风险');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '风险事实补充' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  const retry = await within(dialog).findByRole('button', { name: '重试原请求' });
  expect(within(dialog).getByLabelText('变更 / 申请理由')).toBeDisabled();
  failWrite = undefined; fireEvent.click(retry);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].init.headers).toEqual(writes[0].init.headers);
});

it('offers explicit conflict baseline refresh inside a retained action dialog', async () => {
  failWrite = 409; mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('调整风险');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '保留风险理由' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1)); current.version = 11;
  fireEvent.click(await within(dialog).findByRole('button', { name: '刷新基线并保留草稿' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认提交' })).toBeEnabled());
  expect(within(dialog).getByLabelText('变更 / 申请理由')).toHaveValue('保留风险理由');
  failWrite = undefined; fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].body.expectedVersion).toBe(11);
});

it('requires explicit whole-round cancellation for in-review risk changes', async () => {
  current.allowedActions = ['read', 'risk']; current.status = 'IN_REVIEW'; current.submittedAt = '2026-10-25T10:00:00Z';
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('调整风险');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '实际风险升级' } });
  expect(within(dialog).getByRole('button', { name: '确认提交' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '我确认取消当前整轮审批后变更' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ confirmCancelApproval: true, reason: '实际风险升级', expectedVersion: 7 });
});

it('protects dirty drafts when explicitly refreshing the workspace', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '不可丢失' } });
  fireEvent.click(screen.getByRole('button', { name: '刷新工作区' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('分析过程描述')).toHaveValue('不可丢失');
  expect(writes).toHaveLength(0);
});

it('keeps D5/D6 fields in one corrective action and never infers effectiveness', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D5 ·/ }));
  fireEvent.click(screen.getByRole('button', { name: '增加永久措施' }));
  fireEvent.change(screen.getByLabelText('措施 1 对策'), { target: { value: '增加首件检查' } });
  fireEvent.click(screen.getByRole('button', { name: /^D6 ·/ }));
  const row = within(screen.getByRole('row', { name: /增加首件检查/ }));
  fireEvent.change(row.getByLabelText('措施 1 实施人'), { target: { value: '现场工程师' } });
  fireEvent.change(row.getByLabelText('措施 1 验证人'), { target: { value: '质量工程师' } });
  fireEvent.change(row.getByLabelText('措施 1 实施日期'), { target: { value: '2026-10-26' } });
  const decision = row.getByRole('combobox', { name: '措施 1 人工有效性结论' });
  expect(decision).toHaveValue('');
  fireEvent.click(row.getByRole('button', { name: '详情 措施 1', expanded: false }));
  const details = within(screen.getByRole('region', { name: '措施 1' }));
  fireEvent.change(details.getByLabelText('措施 1 改善前'), { target: { value: '改善前实况' } });
  fireEvent.change(details.getByLabelText('措施 1 改善后'), { target: { value: '改善后实况' } });
  fireEvent.change(details.getByLabelText('措施 1 实际首批断点'), { target: { value: 'LOT-A-001' } });
  fireEvent.change(details.getByLabelText('措施 1 跟踪时长'), { target: { value: '连续两周' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  const saved = writes[0].body.document as Report['document'];
  expect(saved.correctiveActions).toEqual([expect.objectContaining({ action: '增加首件检查', implementer: '现场工程师', verifier: '质量工程师', implementationAt: '2026-10-26',
    beforeState: '改善前实况', afterState: '改善后实况', firstBatch: 'LOT-A-001', followUpDuration: '连续两周', followUpBatchCount: null, effective: null, verificationFileIds: [] })]);
  const savedDecision = await screen.findByRole('combobox', { name: '措施 1 人工有效性结论' });
  fireEvent.change(savedDecision, { target: { value: 'false' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect((writes[1].body.document as Report['document']).correctiveActions).toEqual([{ ...saved.correctiveActions[0], effective: false }]);
});

it('preserves server-supplied containment rows alongside optional blank recommendations', async () => {
  const rows: Report['document']['containment'] = Array.from({ length: 9 }, (_, i) => ({ id: `location-${i}`, group: `组 ${i}`, location: `位置 ${i}`, quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null }));
  current.document.containment = rows; current.document.optionalAffectedContainment = rows.map(row => ({ ...row, id: `optional-${row.id}` }));
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D3 ·/ }));
  expect(within(screen.getByRole('region', { name: '本次问题围堵' })).getAllByRole('row')).toHaveLength(19);
  expect(within(openOptionalContainment()).getAllByRole('row')).toHaveLength(19);
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect((writes[0].body.document as Report['document']).containment[0].quantity).toBeNull();
  expect((writes[0].body.document as Report['document']).containment).toEqual(rows);
});

it('appends a standardization row without replacing or renaming eleven backend presets', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D7 ·/ }));
  expect(screen.queryByLabelText('受控文件 1 文件名称')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '增加标准化文件' }));
  fireEvent.change(screen.getByLabelText('新增文件 12 文件名称'), { target: { value: '专项补充文件' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' })); await waitFor(() => expect(writes).toHaveLength(1));
  const saved = (writes[0].body.document as Report['document']).standardization;
  expect(saved).toHaveLength(12); expect(saved.slice(0, 11)).toEqual(document.standardization);
});

it('uses exact source preview sets and the opaque token, with explicit non-recurrence reasons', async () => {
  current.sources = [{ defectId: 'old-defect', sourceVersion: 2, primary: true, snapshot: { description: '既有来源' } }];
  intercept(path => path.includes('/defects?') ? response({ items: [defect], total: 1, page: 1, pageSize: 20 }) : path.endsWith('/sources/preview') ? response([{ defectId: defect.id, relatedProblems: [{ problemId: 'related-1', reportNumber: '8D-OLD', title: '关联问题', status: 'CLOSED', primary: true }], hasHiddenRelations: true, relatedSetToken: 'opaque-proof-v6' }]) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('调整来源');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('搜索来源台账'), { target: { value: '划伤' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '搜索' }));
  fireEvent.click(await within(dialog).findByRole('checkbox', { name: /台账真实划伤/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '预览并核对来源关联' }));
  fireEvent.change(await within(dialog).findByLabelText('复发关联结论'), { target: { value: 'NOT_RECURRENCE' } });
  expect(within(dialog).getByRole('button', { name: '确认提交' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('关联说明（非复发必填）'), { target: { value: '不同发生机理，经核实非复发' } });
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '补充原始来源' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ add: [{ defectId: 'defect-1', expectedVersion: 6 }], primaryDefectId: 'old-defect', removeDefectIds: [], sourceConfirmations: [{ defectId: 'defect-1', relatedProblemIds: ['related-1'], relatedSetToken: 'opaque-proof-v6', recurrence: 'NOT_RECURRENCE', reason: '不同发生机理，经核实非复发' }] });
});

it('appends closed sources without sending a forbidden primary-source rewrite', async () => {
  current.allowedActions = ['read', 'sources']; current.status = 'CLOSED'; current.closedRevisionId = 'revision-1';
  current.sources = [{ defectId: 'old-defect', sourceVersion: 2, primary: true, snapshot: { description: '既有来源' } }];
  intercept(path => path.includes('/defects?') ? response({ items: [defect], total: 1, page: 1, pageSize: 20 }) : path.endsWith('/sources/preview') ? response([{ defectId: defect.id, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'opaque-no-relations' }]) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('调整来源');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('搜索来源台账'), { target: { value: '划伤' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '搜索' }));
  fireEvent.click(await within(dialog).findByRole('checkbox', { name: /台账真实划伤/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '预览并核对来源关联' }));
  await within(dialog).findByText('未发现其他关联');
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '闭后补充证据来源' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).not.toHaveProperty('primaryDefectId'); expect(writes[0].body.removeDefectIds).toEqual([]);
});

it('searches assignment options with problem, action, organization and section filters', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('专业重派 / 科室内转派');
  const dialog = await screen.findByRole('dialog'); await within(dialog).findByRole('option', { name: '候选负责人 / 部门未填写（user2）' });
  const first = fetcher.mock.calls.map(([url]) => new URL(String(url), 'http://qms.test')).find(url => url.pathname.endsWith('/assignment-options'))!;
  expect(first.searchParams.has('sectionDepartmentId')).toBe(false);
  fireEvent.change(within(dialog).getByLabelText('筛选科室'), { target: { value: 'section-1' } });
  await waitFor(() => expect(within(dialog).getByLabelText('新负责人')).toBeEnabled());
  fireEvent.change(within(dialog).getByLabelText('搜索人员 / 科室'), { target: { value: '候选' } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('/assignment-options?') && new URL(String(url), 'http://qms.test').searchParams.get('search') === '候选')).toBe(true));
  const url = fetcher.mock.calls.map(([url]) => new URL(String(url), 'http://qms.test')).filter(url => url.pathname.endsWith('/assignment-options')).at(-1)!;
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ action: 'REASSIGN', problemId: 'problem-1', organizationId: 'org-1', sectionDepartmentId: 'section-1', page: '1', pageSize: '20' });
});

it('shows planned and actual analysis and submission dates in separate columns', async () => {
  current.analysisDueAt = '2026-10-26T09:00:00Z'; current.analysisCompletedAt = '2026-10-26T08:00:00Z';
  current.submissionDueAt = '2026-10-28T09:00:00Z'; current.submittedAt = '2026-10-27T08:00:00Z';
  mount(); await screen.findByDisplayValue('真实过程问题');
  const table = (await openPlans()).getByRole('table', { name: '计划与实际' });
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['阶段', '计划', '实际']);
  const analysis = within(table).getByRole('row', { name: /分析/ });
  expect(within(analysis).getAllByRole('cell').map(cell => cell.textContent)).toEqual([current.analysisDueAt, current.analysisCompletedAt]);
  const submission = within(table).getByRole('row', { name: /完整提交/ });
  expect(within(submission).getAllByRole('cell').map(cell => cell.textContent)).toEqual([current.submissionDueAt, current.submittedAt]);
});

it('offers nine blank optional D3 positions from empty server arrays without inventing saved rows', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(chapters().getByRole('button', { name: /^D3 ·/ }));
  const main = screen.getByLabelText('本次问题围堵', { selector: '[role="region"]' });
  const optional = openOptionalContainment();
  for (const region of [main, optional]) {
    const checkboxes = region.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const quantities = region.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(checkboxes).toHaveLength(9);
    expect(quantities).toHaveLength(18);
    expect(Array.from(checkboxes).every(input => !input.checked)).toBe(true);
    expect(Array.from(quantities).every(input => input.value === '')).toBe(true);
  }
  fireEvent.change(within(main).getByLabelText('本次问题围堵 1 数量'), { target: { value: '12' } });
  expect(within(main).getByLabelText('本次问题围堵 PCBA 在制品')).toBeChecked();
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  const saved = writes[0].body.document as Report['document'];
  expect(saved.containment).toEqual([expect.objectContaining({ group: 'PCBA', location: '在制品', quantity: 12, ngQuantity: null })]);
  expect(saved.optionalAffectedContainment).toEqual([]);
});

it('selects only optional D3 containment while retaining the original grouped position order', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(chapters().getByRole('button', { name: /^D3 ·/ }));
  const optional = openOptionalContainment();
  const companyContainment = within(optional).getByLabelText('潜在影响围堵 物料 公司内');
  fireEvent.click(companyContainment);
  expect(companyContainment.closest('tr')).toBe(optional.querySelectorAll('tbody tr')[8]);
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  const saved = writes[0].body.document as Report['document'];
  expect(saved.containment).toEqual([]);
  expect(saved.optionalAffectedContainment).toEqual([expect.objectContaining({ group: '物料', location: '公司内', quantity: null, ngQuantity: null })]);
});

it('keeps D7 attachments on each numbered row and requires one to complete the item', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D7 ·/ }));
  const region = screen.getByRole('region', { name: '标准化文件' });
  expect(within(region).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['序号', '相关文件', '是否需更新', '部门 / 主导者', '计划完成日期', '实际完成日期', '状态', '附件', '操作']);
  const row = within(region).getAllByRole('row')[1];
  expect(within(row).getAllByRole('cell')).toHaveLength(9);
  expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('1');
  expect(within(row).queryByRole('button', { name: /详情/ })).not.toBeInTheDocument();
  expect(within(row).getByRole('button', { name: '标准化附件 · 无附件' })).toBeVisible();
  const status = within(row).getByLabelText('受控文件 1 状态');
  fireEvent.change(status, { target: { value: 'COMPLETED' } });
  expect(await within(row).findByRole('alert')).toHaveTextContent('完成前请上传附件');
  expect(status).not.toHaveValue('COMPLETED');
  fireEvent.change(status, { target: { value: 'NOT_APPLICABLE' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect((writes[0].body.document as Report['document']).standardization[0].status).toBe('NOT_APPLICABLE');
});

it('locates generated server field errors to the corrective action while retaining draft inputs', async () => {
  const error: components['schemas']['ErrorResponse'] = { code: 'VALIDATION_FAILED', message: 'incomplete', fields: { 'document.correctiveActions[0].firstBatch': ['请核对实际首批断点'], 'newUnknownField': ['服务端新增提示'] }, traceId: 'trace-1' };
  intercept((path, init) => path.endsWith('/problem-1') && init.method === 'PUT' ? response(error, 400) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(chapters().getByRole('button', { name: /^D5 ·/ }));
  fireEvent.click(screen.getByLabelText('增加永久措施', { selector: 'button' }));
  fireEvent.change(screen.getByLabelText('措施 1 对策'), { target: { value: '不可丢失的措施' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: 'document.correctiveActions[0].firstBatch' }));
  await waitFor(() => expect(screen.getByLabelText('措施 1', { selector: 'section' })).toHaveFocus());
  fireEvent.click(chapters().getByRole('button', { name: /^D5 ·/ }));
  expect(screen.getByLabelText('措施 1 对策')).toHaveValue('不可丢失的措施');
  expect(screen.getByText('服务端新增提示', { exact: false })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'newUnknownField' })).not.toBeInTheDocument();
});

it('locates analysis field errors while preserving the explicitly entered submission plan', async () => {
  current.allowedActions = ['read', 'save', 'analysis-complete'];
  const error: components['schemas']['ErrorResponse'] = { code: 'VALIDATION_FAILED', message: 'incomplete', fields: { occurrenceCause: ['请核对发生因'] }, traceId: 'trace-2' };
  intercept((path, init) => path.endsWith('/analysis-complete') && init.method === 'POST' ? response(error, 400) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(actions().getByRole('button', { name: '确认分析完成' }));
  let dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('正式提交期限'), { target: { value: '2026-11-03T09:30' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: 'occurrenceCause' }));
  await waitFor(() => expect(globalThis.document.getElementById('eight-d-problem-1-D4')).toHaveFocus());
  fireEvent.change(screen.getByLabelText('发生因'), { target: { value: '补充发生因' } });
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await screen.findByText('服务端已确认保存 / 操作成功。');
  fireEvent.click(screen.getByRole('button', { name: '返回操作表单' }));
  dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('正式提交期限')).toHaveValue('2026-11-03T09:30');
});

it('reads CURRENT, APPROVED and historical reports from the report endpoint', async () => {
  current.revisions = [{ id: 'revision-1', contentVersion: 4, recordedAt: '2026-10-25T10:00:00Z' }];
  intercept(path => path.includes('/report?') ? response(controlled(path.includes('revisionId=') ? 'HISTORICAL' : path.includes('view=APPROVED') ? 'APPROVED' : 'CURRENT')) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '未保存的分析不能进入报告' } });
  fireEvent.click(screen.getByRole('tab', { name: '报告' })); expect(await screen.findByText('CURRENT 已保存内容')).toBeVisible();
  expect(screen.queryByText('未保存的分析不能进入报告')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } }); expect(await screen.findByText('APPROVED 已保存内容')).toBeVisible();
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-1' } }); expect(await screen.findByText('HISTORICAL 已保存内容')).toBeVisible();
  const historyUrl = fetcher.mock.calls.map(([url]) => String(url)).find(url => url.includes('/report?') && url.includes('revisionId='))!;
  expect(historyUrl).not.toContain('view=CURRENT'); expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab', { name: '工作区' })); expect(screen.getByLabelText('分析过程描述')).toHaveValue('未保存的分析不能进入报告');
});

it('clears sensitive reports if the authorized PDF download is denied', async () => {
  intercept(path => path.includes('/report?') ? response(controlled('CURRENT')) : path.includes('/report/pdf?') ? response({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); fireEvent.click(screen.getByRole('tab', { name: '报告' })); await screen.findByText('CURRENT 已保存内容');
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  await screen.findByText(/当前会话失效或无权访问/); expect(screen.queryByText('CURRENT 已保存内容')).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/report/pdf?'), expect.objectContaining({ credentials: 'include', headers: { Accept: 'application/pdf' } }));
});

it('keeps the report mounted until its in-flight PDF download settles', async () => {
  let rejectDownload: ((cause: Error) => void) | undefined;
  intercept(path => path.includes('/report?') ? response(controlled('CURRENT')) : path.includes('/report/pdf?') ? new Promise<Response>((_resolve, reject) => { rejectDownload = reject; }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('tab', { name: '报告' })); await screen.findByText('CURRENT 已保存内容');
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  await waitFor(() => expect(rejectDownload).toBeDefined());
  fireEvent.click(screen.getByRole('tab', { name: '工作区' }));
  expect(screen.getByRole('tab', { name: '报告' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('CURRENT 已保存内容')).toBeVisible();
  await act(async () => rejectDownload!(new TypeError('Download unavailable')));
  await waitFor(() => expect(screen.getByRole('tab', { name: '工作区' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByDisplayValue('真实过程问题')).toBeVisible();
});

it('reloads the CURRENT report after saving a draft while viewing the report', async () => {
  intercept(path => path.includes('/report?') ? response({ ...controlled('CURRENT'), snapshot: { ...controlled('CURRENT').snapshot, document: current.document } }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '新保存的分析' } });
  fireEvent.click(screen.getByRole('tab', { name: '报告' }));
  await screen.findByRole('heading', { name: /^D4 ·/ });
  expect(screen.queryByText('新保存的分析')).not.toBeInTheDocument();
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText('新保存的分析')).toBeVisible();
});

it('loads the standard attachment panel when the analysis chapter is first selected', async () => {
  current.document.analysisFileIds = ['file-1'];
  intercept(path => path === '/api/v1/files/file-1' ? response({ id: 'file-1', originalName: 'analysis.png', status: 'AVAILABLE', scanStatus: 'CLEAN', contentType: 'image/png', version: 1 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  expect(fetcher.mock.calls.some(([url]) => url === '/api/v1/files/file-1')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^D4 ·/ }));
  const evidence = analysisPanel();
  expect(await evidence.findByRole('button', { name: '预览附件 analysis.png' })).toBeVisible();
});

it('shows approval decisions in the process log without a separate rounds section', async () => {
  current.status = 'IN_REVIEW';
  current.allowedActions = ['read'];
  const professionalId = '92769cde-bfd8-4e35-8f05-f2a9684ffcd9';
  const managerId = '93d02579-f872-42a7-acb4-b147f7392210';
  const round: components['schemas']['WorkflowClosureRoundDto'] = { id: 'round-1', problemId: 'problem-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', contentVersion: 4, roundNumber: 1, status: 'RETURNED', version: 2, createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z', duties: [
    { id: 'duty-p', duty: 'PROFESSIONAL', status: 'APPROVED', userId: professionalId, userDisplayName: '专业审核员', decidedBy: professionalId, comment: '专业侧核实有效', decidedAt: '2026-10-25T10:00:00Z', version: 2 },
    { id: 'duty-m', duty: 'SECTION_MANAGER', status: 'CANCELLED', userId: managerId, decidedBy: managerId, comment: '请补充验证时长', decidedAt: '2026-10-25T10:00:00Z', version: 2 },
  ] };
  intercept(path => path.includes('/flow-records?') ? response(round.duties.map(duty => ({ occurredAt: duty.decidedAt, person: duty.userDisplayName, content: duty.comment }))) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  expect(screen.queryByRole('region', { name: '并行审核与轮次历史' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '流程日志' }));
  const history = within(await screen.findByRole('table', { name: '流程记录' }));
  await waitFor(() => expect(history.getByText('专业侧核实有效')).toBeVisible());
  expect(history.getByText('专业审核员', { exact: false })).toBeVisible();
  expect(history.getByText('请补充验证时长')).toBeVisible();
  expect(screen.queryByRole('region', { name: '并行审核与轮次历史' })).not.toBeInTheDocument();
  expect(history.queryByText(/固定内容版本|轮次版本/)).not.toBeInTheDocument();
  expect(history.queryByText(professionalId, { exact: false })).not.toBeInTheDocument();
  expect(history.queryByText(managerId, { exact: false })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it('renders stored ISO dates rather than silently showing empty native date controls', async () => {
  current.document.temporaryMeasures = [{ id: 'temporary-1', description: '临时检查', departmentOwner: '现场', introducedAt: '2026-10-24T10:30:00Z', fileIds: [] }];
  mount(); await screen.findByDisplayValue('真实过程问题');
  expect(screen.getByLabelText('导入日期')).toHaveValue('2026-10-24');
});

it('allows removal of an accidentally added corrective action without discarding other edits', async () => {
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.change(screen.getByLabelText('分析过程描述'), { target: { value: '要保留的分析' } });
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D5 ·/ }));
  const measures = within(window.document.getElementById('eight-d-problem-1-D5')!);
  fireEvent.click(measures.getByRole('button', { name: '增加永久措施' }));
  fireEvent.click(measures.getByLabelText('移除措施 1'));
  expect(measures.queryByLabelText('移除措施 1')).not.toBeInTheDocument();
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body.document).toMatchObject({ correctiveActions: [], analysisProcess: '要保留的分析' });
});

it('previews only actually clean available image evidence through an authorized download request', async () => {
  current.document.analysisFileIds = ['file-1'];
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:verified-image'); static revokeObjectURL = vi.fn(); });
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const file: components['schemas']['FileDto'] = { id: 'file-1', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'analysis.png', contentType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null, version: 3, uploadExpiresAt: '2026-10-25T10:00:00Z', scannedAt: '2026-10-25T10:00:00Z', deletedAt: null, retainUntil: '2027-10-25T10:00:00Z' };
  intercept((path, init) => path === '/api/v1/files/file-1' ? response(file) : path === '/api/v1/files/file-1/download' && init.method === 'POST' ? response({ url: 'https://files.example.test/authorized-image' }) : path === 'https://files.example.test/authorized-image' ? new Response(png, { headers: { 'content-type': 'application/octet-stream' } }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D4 ·/ }));
  const evidence = analysisPanel();
  fireEvent.click(await evidence.findByRole('button', { name: '预览附件 analysis.png' }));
  expect(await screen.findByAltText('analysis.png')).toHaveAttribute('src', 'blob:verified-image');
  expect(fetcher).toHaveBeenCalledWith('/api/v1/files/file-1/download', expect.objectContaining({ method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }) }));
});

it('does not preview quarantined evidence or fabricate CLEAN from an id', async () => {
  current.document.analysisFileIds = ['file-1'];
  intercept(path => path === '/api/v1/files/file-1' ? response({ id: 'file-1', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'analysis.png', contentType: 'image/png', status: 'QUARANTINED', scanStatus: 'ERROR', version: 3 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D4 ·/ }));
  const evidence = analysisPanel();
  await evidence.findByText('扫描暂不可用，附件仍隔离');
  expect(evidence.queryByRole('button', { name: '预览附件 analysis.png' })).not.toBeInTheDocument();
  expect(screen.queryByAltText('analysis.png')).not.toBeInTheDocument();
});

it('merges caller preview cancellation with the workspace lifetime AbortSignal', async () => {
  current.document.analysisFileIds = ['file-1'];
  const signals: AbortSignal[] = [];
  intercept((path, init) => {
    if (path === '/api/v1/files/file-1') return response({ id: 'file-1', originalName: 'analysis.png', resourceType: 'process-eight-d', resourceId: 'problem-1', status: 'AVAILABLE', scanStatus: 'CLEAN', contentType: 'image/png', sizeBytes: 12, sha256: 'a'.repeat(64), version: 1 });
    if (path === '/api/v1/files/file-1/download') {
      const signal = init.signal!; signals.push(signal);
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
  });
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: /^D4 ·/ }));
  const evidence = analysisPanel();
  fireEvent.click(await evidence.findByRole('button', { name: '预览附件 analysis.png' }));
  await waitFor(() => expect(signals).toHaveLength(1));
  const preview = await screen.findByRole('dialog', { name: 'analysis.png' });
  fireEvent.click(within(preview).getByRole('button', { name: '关闭' }));
  expect(signals[0].aborted).toBe(true);
  await waitFor(() => expect(preview).not.toBeVisible());
  fireEvent.click(await evidence.findByRole('button', { name: '预览附件 analysis.png' }));
  await waitFor(() => expect(signals).toHaveLength(2));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:other:org-2'));
  expect(signals[1].aborted).toBe(true);
});

it.each(['save', 'action'] as const)('retains CLEAN through temporary %s readOnly and includes it in the next saved draft', async mode => {
  vi.stubGlobal('crypto', webcrypto);
  let file: components['schemas']['FileDto'] = { id: 'uploaded-file', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', scanReason: null, version: 1, uploadExpiresAt: '2026-10-27T10:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2027-10-25T10:00:00Z' };
  let holdRead = false;
  let releaseRead: ((value: Response) => void) | undefined;
  let releaseSave: ((value: Response) => void) | undefined;
  intercept((path, init) => {
    if (path === '/api/v1/files/uploads') return response({ file, uploadUrl: 'https://objects.example.test/upload', headers: {}, urlExpiresAt: file.uploadExpiresAt }, 201);
    if (path === 'https://objects.example.test/upload') return new Response(null, { status: 200 });
    if (path === '/api/v1/files/uploaded-file/complete') { file = { ...file, version: 2, scanStatus: 'PENDING' }; return response(file, 202); }
    if (path === '/api/v1/files/uploaded-file' && !init.method) return holdRead ? new Promise<Response>(resolve => { releaseRead = resolve; }) : response(file);
    if (mode === 'save' && path.endsWith('/problem-1') && init.method === 'PUT' && !releaseSave) return new Promise<Response>(resolve => { releaseSave = resolve; });
  });
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D4 ·/ }));
  const panel = analysisPanel();
  const selected = new File(['clean sample'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('clean sample').buffer });
  fireEvent.change(await panel.findByLabelText('选择附件'), { target: { files: [selected] } });
  await panel.findByText('等待安全扫描');
  const refresh = panel.getByLabelText('刷新附件');
  const save = actions().getByRole('button', { name: '保存草稿' });
  await waitFor(() => expect(refresh).toBeEnabled());
  holdRead = true; fireEvent.click(refresh);
  await waitFor(() => expect(releaseRead).toBeDefined());
  let dialog: HTMLElement | undefined;
  if (mode === 'save') {
    fireEvent.click(save);
    await waitFor(() => expect(releaseSave).toBeDefined());
  } else {
    await chooseMore('调整风险');
    dialog = await screen.findByRole('dialog');
  }
  file = { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  await act(async () => releaseRead!(response(file)));
  if (dialog) fireEvent.click(within(dialog).getByLabelText('取消'));
  else await act(async () => releaseSave!(response(current)));
  await panel.findByRole('button', { name: '下载附件' });
  holdRead = false;
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect((writes[0].body.document as Report['document']).analysisFileIds).toEqual(['uploaded-file']);
});

it('uploads through AttachmentPanel and saves evidence only after the server reports CLEAN', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let file: components['schemas']['FileDto'] = { id: 'uploaded-file', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', scanReason: null, version: 1, uploadExpiresAt: '2026-10-27T10:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2027-10-25T10:00:00Z' };
  intercept((path, init) => {
    if (path === '/api/v1/files/uploads') return response({ file, uploadUrl: 'https://objects.example.test/upload', headers: { 'if-none-match': '*' }, urlExpiresAt: file.uploadExpiresAt }, 201);
    if (path === 'https://objects.example.test/upload') return new Response(null, { status: 200 });
    if (path === '/api/v1/files/uploaded-file/complete') { file = { ...file, version: 2, scanStatus: 'PENDING' }; return response(file, 202); }
    if (path === '/api/v1/files/uploaded-file' && !init.method) return response(file);
  });
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D4 ·/ }));
  const panel = analysisPanel();
  const save = actions().getByRole('button', { name: '保存草稿' });
  const selected = new File(['clean sample'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('clean sample').buffer });
  fireEvent.change(await panel.findByLabelText('选择附件'), { target: { files: [selected] } });
  await panel.findByText('等待安全扫描');
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect((writes[0].body.document as Report['document']).analysisFileIds).toEqual([]);
  const refresh = panel.getByLabelText('刷新附件');
  await waitFor(() => expect(refresh).toBeEnabled());
  file = { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN', scannedAt: '2026-10-26T10:00:00Z' };
  fireEvent.click(refresh);
  await panel.findByRole('button', { name: '下载附件' });
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect((writes[1].body.document as Report['document']).analysisFileIds).toEqual(['uploaded-file']);
  expect(fetcher).toHaveBeenCalledWith('https://objects.example.test/upload', expect.objectContaining({ method: 'PUT', body: selected, credentials: 'omit' }));
  const initialize = fetcher.mock.calls.find(([path]) => path === '/api/v1/files/uploads')!;
  expect(JSON.parse(initialize[1].body)).toMatchObject({ resourceType: 'process-eight-d', resourceId: 'problem-1', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

it('blocks editing-ending entries while a real SharedPanel upload is pending, but can save and recover CLEAN', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let complete!: (value: Response) => void;
  let file = { id: 'uploaded-pending', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'pending.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', version: 1 };
  intercept(path => {
    if (path === '/api/v1/files/uploads') return response({ file, uploadUrl: 'https://objects.example.test/pending-upload', headers: {} }, 201);
    if (path === 'https://objects.example.test/pending-upload') return new Response(null);
    if (path === '/api/v1/files/uploaded-pending/complete') return new Promise<Response>(resolve => { complete = resolve; });
    if (path === '/api/v1/files/uploaded-pending') return response(file);
  });
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D4 ·/ }));
  const panel = analysisPanel();
  const workflowActions = actions();
  const save = workflowActions.getByRole('button', { name: '保存草稿' });
  const submit = workflowActions.getByRole('button', { name: '完整提交' });
  const selected = new File(['sample'], 'pending.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  fireEvent.change(await panel.findByLabelText('选择附件'), { target: { files: [selected] } });
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  expect(submit).toBeDisabled();
  const menu = await openMore();
  expect(menu.getByRole('menuitem', { name: '专业重派 / 科室内转派' })).toHaveAttribute('aria-disabled', 'true');
  expect(menu.getByRole('menuitem', { name: '调整风险' })).not.toHaveAttribute('aria-disabled', 'true');
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  await waitFor(() => expect(save).toBeEnabled());
  file = { ...file, version: 2, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  await act(async () => complete(response(file)));
  await panel.findByRole('button', { name: '下载附件' });
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect((writes[1].body.document as Report['document']).analysisFileIds).toEqual(['uploaded-pending']);
  await waitFor(() => expect(submit).toBeEnabled());
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});

it.each(['完整提交', '专业重派 / 科室内转派'])('guards sending %s when evidence becomes pending after the action form opens, without locking cancel', async name => {
  current.document.analysisFileIds = ['late-pending'];
  let release!: (value: Response) => void;
  intercept(path => path === '/api/v1/files/late-pending' ? new Promise<Response>(resolve => { release = resolve; }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(within(screen.getByLabelText('8D 内容分区')).getByRole('button', { name: /^D4 ·/ }));
  const panel = analysisPanel();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const workflowActions = actions();
  const save = workflowActions.getByRole('button', { name: '保存草稿' });
  if (name === '完整提交') fireEvent.click(workflowActions.getByRole('button', { name }));
  else await chooseMore(name);
  const actionDialog = (await screen.findByText(`8D-001 · ${name}`)).closest<HTMLElement>('[role="dialog"]')!;
  const dialog = within(actionDialog);
  if (name !== '完整提交') {
    await dialog.findByText('科室一 · S1', { selector: 'option' });
    fireEvent.change(dialog.getByLabelText('筛选科室'), { target: { value: 'section-1' } });
    const owner = dialog.getByLabelText('新负责人');
    await waitFor(() => expect(owner).toBeEnabled());
    fireEvent.change(owner, { target: { value: 'owner-2' } });
    fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '真实转派理由' } });
  }
  const submit = dialog.getByRole('button', { name: '确认提交' });
  expect(submit).toBeEnabled();
  await act(async () => release(response({ id: 'late-pending', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'late.txt', status: 'QUARANTINED', scanStatus: 'PENDING', version: 1 })));
  await panel.findByText('等待安全扫描');
  fireEvent.submit(submit.closest('form')!);
  await dialog.findByText(/附件.*处理中/);
  expect(writes).toHaveLength(0);
  const cancel = dialog.getByLabelText('取消');
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);
  await waitFor(() => expect(actionDialog).not.toBeVisible());
  expect(save).toBeEnabled();
});

it('uses actual task extension stages and both row/instance versions for an explicit deadline request', async () => {
  intercept(path => path.includes('/eight-d/tasks?') ? response({ items: [{ id: 'handling:problem-1', kind: 'HANDLING', problemId: 'problem-1', rowVersion: 7, instanceVersion: 3, actions: ['REQUEST_EXTENSION'], extensionStages: ['SUBMISSION'] }], total: 1 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('申请延期');
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('延期阶段')).toHaveValue('SUBMISSION'));
  fireEvent.change(within(dialog).getByLabelText('申请新期限'), { target: { value: '2026-11-01T16:00' } });
  fireEvent.change(within(dialog).getByLabelText('变更 / 申请理由'), { target: { value: '追加真实批次验证' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe('/api/v1/workflow-deadline-extensions/problems/problem-1/requests');
  expect(writes[0].body).toEqual({ expectedRowVersion: 7, expectedInstanceVersion: 3, stage: 'SUBMISSION', requestedDueAt: new Date('2026-11-01T16:00').toISOString(), reason: '追加真实批次验证' });
});

function reviewExtension() {
  current.status = 'IN_REVIEW'; current.allowedActions = ['read', 'request-extension'];
  return { id: 'extension-request:problem-1', kind: 'EXTENSION_REQUEST', status: 'AVAILABLE', problemId: 'problem-1',
    rowVersion: 7, instanceVersion: 3, actions: ['OPEN_REPORT', 'REQUEST_EXTENSION'], extensionStages: ['CLOSURE'] };
}

it('allows only a server-projected closure extension during review and keeps content locked', async () => {
  const task = reviewExtension();
  intercept(path => path.includes('/eight-d/tasks?') ? response({ items: [task], total: 1 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  for (const name of ['保存草稿', '完整提交']) expect(actions().queryByRole('button', { name })).not.toBeInTheDocument();
  expect(screen.getByLabelText('分析过程描述')).toBeDisabled();
  const menu = await openMore();
  expect(menu.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['申请延期']);
  fireEvent.click(menu.getByRole('menuitem', { name: '申请延期' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByLabelText('延期阶段')).toHaveValue('CLOSURE'));
  expect(dialog.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['CLOSURE']);
  fireEvent.change(dialog.getByLabelText('申请新期限'), { target: { value: '2026-11-01T16:00' } });
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '审批期间追加验证' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ path: '/api/v1/workflow-deadline-extensions/problems/problem-1/requests',
    body: { stage: 'CLOSURE', expectedRowVersion: 7, expectedInstanceVersion: 3, reason: '审批期间追加验证' },
    init: { method: 'POST', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) } } });
  expect(screen.getByLabelText('分析过程描述')).toBeDisabled();
});

it('does not infer extension permission from owner fields or submit permission', async () => {
  current.allowedActions = ['read', 'submit'];
  mount(); await screen.findByDisplayValue('真实过程问题');
  expect(actions().queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
});

it.each(['pending', 'wrong-problem', 'stale-row', 'stale-instance'])('does not send an extension for %s task eligibility', async mode => {
  const task = reviewExtension();
  if (mode === 'wrong-problem') task.problemId = 'other-problem';
  if (mode === 'stale-row') task.rowVersion++;
  if (mode === 'stale-instance') task.instanceVersion++;
  intercept(path => path.includes('/eight-d/tasks?') ? response({ items: mode === 'pending' ? [] : [task], total: 1 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('申请延期');
  const dialog = within(await screen.findByRole('dialog'));
  if (mode === 'pending' || mode === 'wrong-problem') await dialog.findByText('当前无可申请延期阶段');
  else await waitFor(() => expect(dialog.getByLabelText('延期阶段')).toHaveValue('CLOSURE'));
  fireEvent.change(dialog.getByLabelText('申请新期限'), { target: { value: '2026-11-01T16:00' } });
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '不应发送' } });
  expect(dialog.getByRole('button', { name: '确认提交' })).toBeDisabled();
  fireEvent.click(dialog.getByRole('button', { name: '确认提交' })); expect(writes).toHaveLength(0);
});

it.each([401, 403])('clears extension eligibility and content after a %s task read', async status => {
  reviewExtension();
  intercept(path => path.includes('/eight-d/tasks?') ? response({ code: 'FEATURE_PERMISSION_DENIED', message: 'refused' }, status) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('申请延期');
  await screen.findByText(/敏感内容已清除/);
  expect(screen.queryByDisplayValue('真实过程问题')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

it('ignores late extension eligibility after the session scope changes', async () => {
  const task = reviewExtension(); let release!: (value: Response) => void;
  intercept(path => path.includes('/eight-d/tasks?') ? new Promise(resolve => { release = resolve; }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  await chooseMore('申请延期');
  await waitFor(() => expect(release).toBeDefined());
  current.allowedActions = ['read'];
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:other:org-1'));
  await act(async () => release(response({ items: [task], total: 1 })));
  await screen.findByDisplayValue('真实过程问题');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '办理操作' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

it('posts analysis completion with an explicitly chosen complete-submission plan', async () => {
  current.allowedActions = ['read', 'save', 'analysis-complete'];
  mount(); await screen.findByDisplayValue('真实过程问题'); fireEvent.click(actions().getByRole('button', { name: '确认分析完成' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('正式提交期限'), { target: { value: '2026-11-03T09:30' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认提交' })); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe('/api/v1/process-quality/eight-d/problem-1/analysis-complete');
  expect(writes[0].body).toEqual({ organizationId: 'org-1', expectedVersion: 7, submissionDueAt: new Date('2026-11-03T09:30').toISOString() });
});

it('opens the existing closure inbox and never submits review decisions through the 8D form', async () => {
  intercept(path => path.includes('/tasks/closure?') || path.includes('/notifications/closure?') ? response({ items: [], total: 0 }) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题');
  fireEvent.click(screen.getByRole('button', { name: '流程日志' }));
  const history = within(await screen.findByRole('dialog', { name: '流程日志' }));
  fireEvent.click(history.getByRole('button', { name: '打开关闭职责待办' }));
  const inbox = within(await screen.findByRole('dialog', { name: '关闭职责待办' }));
  await inbox.findByText('暂无关闭职责待办');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/v1/tasks/closure?'))).toBe(true);
  expect(writes).toHaveLength(0);
});

it('invalidates a source preview after explicit conflict-baseline refresh', async () => {
  failWrite = 409;
  current.sources = [{ defectId: 'old-defect', sourceVersion: 2, primary: true, snapshot: { description: '既有来源' } }];
  intercept(path => path.includes('/defects?') ? response({ items: [defect], total: 1, page: 1, pageSize: 20 }) : path.endsWith('/sources/preview') ? response([{ defectId: defect.id, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'opaque-before-conflict' }]) : undefined);
  mount(); await screen.findByDisplayValue('真实过程问题'); await chooseMore('调整来源');
  const dialog = within((await screen.findByText('8D-001 · 调整来源')).closest('[role="dialog"]')!);
  fireEvent.change(dialog.getByLabelText('搜索来源台账'), { target: { value: '划伤' } });
  fireEvent.click(dialog.getByRole('button', { name: '搜索' }));
  fireEvent.click(await dialog.findByLabelText(/台账真实划伤/));
  fireEvent.click(dialog.getByRole('button', { name: '预览并核对来源关联' }));
  await dialog.findByText('未发现其他关联');
  fireEvent.change(dialog.getByLabelText('变更 / 申请理由'), { target: { value: '重新核对来源' } });
  const submit = dialog.getByRole('button', { name: '确认提交' });
  fireEvent.click(submit);
  await waitFor(() => expect(writes).toHaveLength(1));
  current.version = 12;
  fireEvent.click(await dialog.findByRole('button', { name: '刷新基线并保留草稿' }));
  expect(dialog.queryByText(/记录版本/)).not.toBeInTheDocument();
  await waitFor(() => {
    expect(dialog.queryByText('未发现其他关联')).not.toBeInTheDocument();
    expect(submit).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });
});
