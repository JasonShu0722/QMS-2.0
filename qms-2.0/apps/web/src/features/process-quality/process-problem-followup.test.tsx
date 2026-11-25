import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProblemCenterPage } from '../problem-center/ProblemCenterPage';
import * as api from '../problem-center/problem-center-api';
import { ProblemWorkspacePage } from '../problem-workspace/ProblemWorkspacePage';

vi.mock('../problem-center/problem-center-api', () => ({
  getProblemOrganizationId: vi.fn(), getProblemIndex: vi.fn(), getProcessFollowup: vi.fn(), getProblemViews: vi.fn(),
  createProblemView: vi.fn(), updateProblemView: vi.fn(), deleteProblemView: vi.fn(),
}));
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn() }));

const problem = {
  id: 'problem-1', organizationId: 'org-1', reportNumber: '8D-001', domainCode: 'process-quality', problemType: 'PROCESS_DEFECT',
  sourceType: 'process-defect', sourceId: 'source-1', status: 'IN_PROGRESS', severity: 'HIGH', responsibleParty: null, ownerId: 'owner-1',
  dueAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z', version: 1,
  stage: 'ANALYSIS', responsibleSectionDepartmentId: 'section-1',
  summary: { title: '8D-001', description: '正式8D划伤问题', domainUiKey: 'process-eight-d' },
} as const;
const projectedProblem = { ...problem, summary: { ...problem.summary, fields: [
  { key: 'responsibleSectionName', label: '责任科室', value: '焊接质量科' }, { key: 'ownerName', label: '负责人', value: '负责人甲' },
  { key: 'stage', label: '当前阶段', value: '分析阶段' },
  { key: 'analysisDueAt', label: '分析期限', value: '2020-01-01T00:00:00Z' }, { key: 'submissionDueAt', label: '完整提交期限', value: null },
  { key: 'closureDueAt', label: '关闭期限', value: null }, { key: 'analysisCompletedAt', label: '分析完成时间', value: null },
  { key: 'submittedAt', label: '完整提交时间', value: null },
] } };
const result = { items: [projectedProblem], total: 1, page: 1, pageSize: 25, statusCounts: [{ status: 'IN_PROGRESS' as const, count: 1 }] };
const view: components['schemas']['ProblemSavedViewDto'] = {
  id: 'view-1', organizationId: 'org-1', name: '视图甲', version: 1, createdAt: '', updatedAt: '',
  configuration: { schemaVersion: 1, filters: {}, sort: { sortBy: 'updatedAt', sortDirection: 'desc' }, visibleColumns: ['reportNumber', 'title'], columnOrder: ['reportNumber', 'title'] },
};
const mount = async (query = '') => {
  const rendered = render(<MemoryRouter initialEntries={[`/app/process-quality/problems${query}`]}><LanguageProvider><ProblemCenterPage processQuality /></LanguageProvider></MemoryRouter>);
  await act(async () => {});
  return rendered;
};

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession('INTERNAL:org-1:process-followup-test');
  vi.mocked(api.getProblemOrganizationId).mockResolvedValue('org-1');
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getProcessFollowup).mockResolvedValue(result);
});

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: '筛选条件' }));
afterEach(() => {
  vi.useRealTimers();
  useWorkTabsStore.getState().reset();
});

it('keeps the compact ledger mounted and edits the same filter from the header and toolbar', async () => {
  await mount();
  const table = document.querySelector<HTMLElement>('.qms-ledger')!;
  const toolbar = screen.getByRole('group', { name: '台账工具栏' });
  expect(table).toHaveClass('qms-ledger--compact-headers', 'qms-ledger--compact-layout', 'qms-ledger--sticky');
  expect(within(table).getAllByRole('columnheader').map(header => header.getAttribute('aria-label'))).toEqual([
    '报告编号', '问题标题', '当前环节', '状态', '风险', '责任科室', '负责人', '办理期限',
  ]);
  expect(screen.queryByLabelText('组织上下文')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('保存视图')).not.toBeInTheDocument();
  const status = within(table).getByRole('button', { name: '按状态筛选' });
  fireEvent.click(status);
  const panel = await screen.findByRole('dialog', { name: '筛选面板' });
  const field = within(panel).getByLabelText('状态筛选');
  await waitFor(() => expect(field).toHaveFocus());
  expect(within(panel).getByLabelText('组织上下文')).toBeInTheDocument();
  expect(within(panel).getByLabelText('保存视图')).toBeInTheDocument();
  expect(within(toolbar).queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.qms-ledger')).toBe(table);
  fireEvent.change(field, { target: { value: 'OPEN' } });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(field, { key: 'Escape' });
  await waitFor(() => expect(status).toHaveAttribute('aria-pressed', 'true'));
  expect(status).toHaveFocus();
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'OPEN', page: 1 }), expect.any(AbortSignal));
  openFilters();
  expect(within(await screen.findByRole('dialog')).getByLabelText('状态筛选')).toHaveValue('OPEN');
});

it('restores the server page and applied filters on detail return, without carrying them to another organization', async () => {
  vi.mocked(api.getProcessFollowup).mockImplementation(async query => ({ ...result, items: [{ ...projectedProblem, organizationId: query.organizationId! }], page: query.page!, pageSize: query.pageSize!, total: 51 }));
  const detail: components['schemas']['ProblemWorkspaceDto'] = {
    problem: { ...problem, organizationId: 'org-other' }, domain: null, domainAvailability: 'UNAVAILABLE',
    selectedInstance: null, instances: [], readOnly: true, nodes: [], workflowActions: [], actions: [], task: null, evidence: [], upgrades: [],
    capabilities: { canAct: false, allowedActions: [], reasonCode: null, currentNodeId: null, taskId: null, claimedByUserId: null, projectionPending: false },
  };
  vi.mocked(apiRequest).mockResolvedValue(detail);
  render(<MemoryRouter initialEntries={['/app/process-quality/problems?organizationId=org-other']}><LanguageProvider><Routes>
    <Route path="/app/process-quality/problems" element={<ProblemCenterPage processQuality />} />
    <Route path="/app/problem-workspace/:problemId" element={<ProblemWorkspacePage problemId="problem-1" />} />
  </Routes></LanguageProvider></MemoryRouter>);
  await screen.findByRole('link', { name: '8D-001' });
  openFilters();
  fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'OPEN' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await screen.findByTitle('2');
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, status: 'OPEN' }), expect.any(AbortSignal)));
  fireEvent.click(await screen.findByRole('link', { name: '8D-001' }));
  const returnLink = await screen.findByRole('link', { name: '返回制程问题跟进' });
  expect(returnLink).toHaveAttribute('href', '/app/process-quality/problems?organizationId=org-other');
  fireEvent.click(returnLink);
  await screen.findByRole('link', { name: '8D-001' });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org-other', page: 2, status: 'OPEN' }), expect.any(AbortSignal));
  openFilters();
  fireEvent.change(screen.getByLabelText('组织上下文'), { target: { value: 'org-2' } });
  fireEvent.click(screen.getByRole('button', { name: '切换组织' }));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org-2', page: 1 }), expect.any(AbortSignal)));
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('status');
}, 60_000);

it('locks the process domain and formal response against a hostile URL and exposes no domain editor', async () => {
  await mount('?domainCode=supplier-quality&problemType=SCAR&responseForm=BRIEF');
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  expect(api.getProblemIndex).not.toHaveBeenCalled();
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith({ organizationId: 'org-1', page: 1, pageSize: 20, sortBy: 'updatedAt', sortDirection: 'desc' }, expect.any(AbortSignal));
  expect(screen.queryByLabelText('领域代码')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '问题类型' })).not.toBeInTheDocument();
});

it('overrides saved-view domain and type while retaining its supported status filter', async () => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [{ id: 'foreign', organizationId: 'org-1', name: '其他领域视图', version: 1, createdAt: '', updatedAt: '', configuration: {
    schemaVersion: 1, filters: { domainCode: 'supplier-quality', problemType: 'SCAR', status: 'OPEN' }, sort: { sortBy: 'updatedAt', sortDirection: 'desc' }, visibleColumns: ['reportNumber'], columnOrder: ['reportNumber'],
  } }], total: 1 });
  await mount();
  openFilters();
  fireEvent.change(screen.getByLabelText('保存视图'), { target: { value: 'foreign' } });
  await act(async () => { fireEvent.click(screen.getByText('应用视图', { selector: 'button span' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'OPEN' }), expect.any(AbortSignal));
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('domainCode');
});

it('round-trips process filters and a hidden phase column through a saved view', async () => {
  vi.mocked(api.createProblemView).mockImplementation(async (_organizationId, body) => ({ ...view, ...body }));
  const { unmount } = await mount();
  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '显示 当前环节' }));
  expect(screen.queryByRole('columnheader', { name: '当前环节' })).not.toBeInTheDocument();
  openFilters();
  const panel = within(await screen.findByRole('dialog'));
  fireEvent.change(panel.getByLabelText('当前环节'), { target: { value: 'CLOSURE_REVIEW' } });
  fireEvent.change(panel.getByRole('textbox', { name: '责任科室' }), { target: { value: ' 焊接质量 ' } });
  fireEvent.change(panel.getByRole('textbox', { name: '负责人' }), { target: { value: ' 负责人甲 ' } });
  fireEvent.change(panel.getByLabelText('视图名称'), { target: { value: '关闭审批关注' } });
  await act(async () => { fireEvent.click(panel.getByRole('button', { name: '保存新视图' })); });
  const expectedFilters = { stage: 'CLOSURE_REVIEW', responsibleSectionName: '焊接质量', ownerName: '负责人甲' };
  expect(api.createProblemView).toHaveBeenCalledWith('org-1', expect.objectContaining({ configuration: expect.objectContaining({
    filters: expectedFilters, columnOrder: expect.arrayContaining(['processStage']),
  }) }));
  expect(vi.mocked(api.createProblemView).mock.lastCall?.[1].configuration.visibleColumns).not.toContain('processStage');
  const saved = await vi.mocked(api.createProblemView).mock.results[0]!.value;
  unmount();
  useWorkTabsStore.getState().reset();
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [saved], total: 1 });
  await mount();
  openFilters();
  const reloadedPanel = within(screen.getByRole('dialog'));
  fireEvent.change(reloadedPanel.getByLabelText('保存视图'), { target: { value: saved.id } });
  await act(async () => { fireEvent.click(reloadedPanel.getByRole('button', { name: '应用视图' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining(expectedFilters), expect.any(AbortSignal));
  expect(reloadedPanel.getByRole('textbox', { name: '负责人' })).toHaveValue('负责人甲');
  expect(reloadedPanel.getByRole('textbox', { name: '责任科室' })).toHaveValue('焊接质量');
  expect(screen.queryByRole('columnheader', { name: '当前环节' })).not.toBeInTheDocument();
}, 60_000);

it('retains the fixed formal process scope through a supported search and reset', async () => {
  await mount();
  openFilters();
  const panel = within(await screen.findByRole('dialog'));
  fireEvent.change(panel.getByLabelText('报告编号检索'), { target: { value: '8D-001' } });
  fireEvent.change(panel.getByLabelText('状态筛选'), { target: { value: 'OPEN' } });
  await act(async () => { fireEvent.click(panel.getByRole('button', { name: '应用筛选' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8D-001', status: 'OPEN' }), expect.any(AbortSignal));
  openFilters();
  await act(async () => { fireEvent.click(screen.getByText(/重\s*置/, { selector: 'button span' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith({ organizationId: 'org-1', page: 1, pageSize: 20, sortBy: 'updatedAt', sortDirection: 'desc' }, expect.any(AbortSignal));
}, 30_000);

it('submits header phase and effective-deadline filters and deadline sort as one server query', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '按负责人筛选' }));
  const panel = within(await screen.findByRole('dialog'));
  expect(panel.getByRole('textbox', { name: '负责人' })).toHaveFocus();
  fireEvent.change(panel.getByRole('textbox', { name: '负责人' }), { target: { value: ' 负责人甲 ' } });
  fireEvent.click(screen.getByRole('button', { name: '按责任科室筛选' }));
  expect(panel.getByRole('textbox', { name: '责任科室' })).toHaveFocus();
  fireEvent.change(panel.getByRole('textbox', { name: '责任科室' }), { target: { value: ' 焊接质量 ' } });
  fireEvent.change(panel.getByLabelText('当前环节'), { target: { value: 'CLOSURE_REVIEW' } });
  fireEvent.change(panel.getByLabelText('办理期限起始'), { target: { value: '2026-09-25T09:00' } });
  fireEvent.click(panel.getByLabelText('仅看当前已逾期'));
  fireEvent.change(panel.getByLabelText('排序字段'), { target: { value: 'dueAt' } });
  fireEvent.change(panel.getByLabelText('排序方向'), { target: { value: 'asc' } });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(1);
  fireEvent.click(panel.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({
    stage: 'CLOSURE_REVIEW', ownerName: '负责人甲', responsibleSectionName: '焊接质量', dueFrom: new Date('2026-09-25T09:00').toISOString(), overdueAt: expect.any(String), sortBy: 'dueAt', sortDirection: 'asc', page: 1,
  }), expect.any(AbortSignal)));
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('ownerId');
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('responsibleSectionDepartmentId');
}, 30_000);

it('shows the description as title instead of repeating the report number, with projected names and deadlines and no full-report reads', async () => {
  await mount();
  const title = await screen.findByText('正式8D划伤问题');
  const row = within(title.closest('tr')!);
  expect(row.getByRole('link', { name: '8D-001' })).toHaveAttribute('href', '/app/problem-workspace/problem-1?organizationId=org-1');
  expect(row.getAllByText('8D-001')).toHaveLength(1);
  expect(row.getByText('焊接质量科')).toBeVisible();
  expect(row.getByText('负责人甲')).toBeVisible();
  expect(row.queryByText('owner-1')).not.toBeInTheDocument();
  expect(row.getByText('高风险')).toBeVisible();
  expect(row.getByText('分析阶段')).toBeVisible();
  expect(row.queryByText('已逾期')).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('uses server-side formal-only totals, status counts and paging rather than a client-filtered row count', async () => {
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, total: 51, statusCounts: [{ status: 'IN_PROGRESS', count: 51 }] });
  await mount();
  await screen.findByText('正式8D划伤问题');
  expect(screen.getByText(/^总数:\s*51$/)).toBeVisible();
  expect(screen.getByText(/^处理中:\s*51$/)).toBeVisible();
  expect(screen.queryByText(/旧简报/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal)));
});

it('bounds a long problem-description excerpt and preserves the full description as its omission hint', async () => {
  const description = `涂层失效现象${'需要核对实际批次与措施。'.repeat(40)}`;
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...projectedProblem, summary: { ...projectedProblem.summary, description } }] });
  await mount();
  const row = within((await screen.findByRole('link', { name: '8D-001' })).closest('tr')!);
  const excerpt = row.getByTitle(description);
  expect(excerpt.textContent!.length).toBeLessThanOrEqual(201);
  expect(excerpt).toHaveTextContent(/^涂层失效现象/);
  expect(row.getAllByText('8D-001')).toHaveLength(1);
});

it('uses a fresh overdue cutoff on explicit refresh, not on unrelated renders', async () => {
  const beforeDeadline = '2026-11-25T19:00:00.000Z';
  const deadline = '2026-11-25T19:05:00.000Z';
  const afterDeadline = '2026-11-25T19:10:00.000Z';
  vi.setSystemTime(new Date(beforeDeadline));
  vi.mocked(api.getProcessFollowup).mockImplementation(async ({ overdueAt }) => !overdueAt || overdueAt > deadline
    ? { ...result, items: [{ ...projectedProblem, dueAt: deadline }] }
    : { ...result, items: [], total: 0, statusCounts: [] });
  await mount();
  openFilters();
  fireEvent.click(screen.getByLabelText('仅看当前已逾期'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用筛选' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ overdueAt: beforeDeadline }), expect.any(AbortSignal));
  expect(screen.queryByRole('link', { name: '8D-001' })).not.toBeInTheDocument();

  vi.setSystemTime(new Date(afterDeadline));
  openFilters();
  fireEvent.click(screen.getByRole('button', { name: '关闭筛选' }));
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(2);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(3);
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ overdueAt: afterDeadline }), expect.any(AbortSignal));
  expect(screen.getByRole('link', { name: '8D-001' })).toBeVisible();
}, 60_000);

it.each([401, 403])('clears the whole scoped list when the index refresh rejects with %s', async status => {
  let reject!: (cause: unknown) => void;
  await mount();
  await screen.findByText('正式8D划伤问题');
  const refresh = screen.getByText(/刷\s*新/, { selector: 'button span' }).closest('button')!;
  expect(refresh).not.toHaveClass('ant-btn-loading');
  vi.mocked(api.getProcessFollowup).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => { fireEvent.click(refresh); });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(2);
  await act(async () => reject(new ApiError({ code: status === 401 ? 'UNAUTHENTICATED' : 'FEATURE_PERMISSION_DENIED', message: 'secret' }, status)));
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).toBeVisible();
  expect(screen.queryByText('正式8D划伤问题')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '8D-001' })).not.toBeInTheDocument();
});

it.each([401, 403])('clears loaded process data on read view permission %s', async status => {
  let rejectViews!: (cause: unknown) => void;
  vi.mocked(api.getProblemViews).mockImplementation(() => new Promise((_, reject) => { rejectViews = reject; }));
  await mount();
  await screen.findByText('正式8D划伤问题');
  expect(screen.getByText('负责人甲')).toBeInTheDocument();
  const signal = vi.mocked(api.getProblemViews).mock.calls[0]![1]!;
  await act(async () => rejectViews(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status)));
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).toBeVisible();
  expect(signal.aborted).toBe(true);
  expect(screen.queryByTitle('正式8D划伤问题')).not.toBeInTheDocument();
  expect(screen.queryByText('负责人甲')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '当前期限' })).not.toBeInTheDocument();
});

it('aborts the pending index read and prevents resurrection after read view permission loss', async () => {
  let rejectViews!: (cause: unknown) => void;
  let finishIndex!: (value: typeof result) => void;
  vi.mocked(api.getProblemViews).mockImplementation(() => new Promise((_, reject) => { rejectViews = reject; }));
  await mount();
  await screen.findByText('正式8D划伤问题');
  const refresh = screen.getByText(/刷\s*新/, { selector: 'button span' }).closest('button')!;
  expect(refresh).not.toHaveClass('ant-btn-loading');
  vi.mocked(api.getProcessFollowup).mockImplementation(() => new Promise(resolve => { finishIndex = resolve; }));
  await act(async () => { fireEvent.click(refresh); });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(2);
  const signal = vi.mocked(api.getProcessFollowup).mock.calls[1]![1]!;
  await act(async () => rejectViews(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403)));
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).toBeVisible();
  expect(signal.aborted).toBe(true);
  await act(async () => finishIndex(result));
  expect(screen.queryByText('正式8D划伤问题')).not.toBeInTheDocument();
  expect(screen.queryByText('负责人甲')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '当前期限' })).not.toBeInTheDocument();
});

it.each([
  { action: 'create', status: 401 }, { action: 'create', status: 403 },
  { action: 'update', status: 401 }, { action: 'update', status: 403 },
  { action: 'delete', status: 401 }, { action: 'delete', status: 403 },
] as const)('clears loaded process data on $action view permission $status', async ({ action, status }) => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [view], total: 1 });
  const cause = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status);
  vi.mocked(api.createProblemView).mockRejectedValue(cause);
  vi.mocked(api.updateProblemView).mockRejectedValue(cause);
  vi.mocked(api.deleteProblemView).mockRejectedValue(cause);
  await mount();
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  openFilters();
  expect(screen.getByText('视图甲', { selector: 'option' })).toBeInTheDocument();
  expect(screen.getByText('保存新视图', { selector: 'button span' }).closest('button')).toBeEnabled();
  expect(screen.getByText('负责人甲')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('保存视图'), { target: { value: view.id } });
  await act(async () => { fireEvent.click(screen.getByText(action === 'create' ? '保存新视图' : action === 'update' ? '更新视图' : '删除视图', { selector: 'button span' })); });
  if (action === 'delete') {
    const confirm = await screen.findByRole('button', { name: /^删\s*除$/ });
    await act(async () => { fireEvent.click(confirm); });
  }
  expect(action === 'create' ? api.createProblemView : action === 'update' ? api.updateProblemView : api.deleteProblemView).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).toBeVisible();
  expect(screen.queryByTitle('正式8D划伤问题')).not.toBeInTheDocument();
  expect(screen.queryByText('负责人甲')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '当前期限' })).not.toBeInTheDocument();
}, 30_000);

it.each([
  { action: 'read', status: 401 }, { action: 'read', status: 403 },
  { action: 'create', status: 401 }, { action: 'create', status: 403 },
] as const)('ignores a late denied view $action / $status from the previous organization scope', async ({ action, status }) => {
  let rejectOld!: (cause: unknown) => void;
  vi.mocked(api.getProcessFollowup).mockImplementation(async query => ({ ...result, items: [{ ...projectedProblem, organizationId: query.organizationId ?? 'org-1', summary: { ...projectedProblem.summary, description: query.organizationId === 'org-2' ? '组织二问题' : '正式8D划伤问题' } }] }));
  vi.mocked(api.getProblemViews).mockImplementation(query => action === 'read' && query.organizationId === 'org-1' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve({ items: [view], total: 1 }));
  vi.mocked(api.createProblemView).mockImplementation(() => new Promise((_, reject) => { rejectOld = reject; }));
  await act(async () => { render(<MemoryRouter initialEntries={['/app/process-quality/problems?organizationId=org-1']}><LanguageProvider><ProblemCenterPage processQuality /><Link to="/app/process-quality/problems?organizationId=org-2">转到组织二</Link></LanguageProvider></MemoryRouter>); });
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  if (action === 'create') {
    openFilters();
    expect(screen.getByText('视图甲', { selector: 'option' })).toBeInTheDocument();
    expect(screen.getByText('保存新视图', { selector: 'button span' }).closest('button')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('视图名称'), { target: { value: '旧范围草稿' } });
    await act(async () => { fireEvent.click(screen.getByText('保存新视图', { selector: 'button span' })); });
    expect(api.createProblemView).toHaveBeenCalledTimes(1);
  }
  await act(async () => { fireEvent.click(screen.getByText('转到组织二')); });
  expect(screen.getByText('组织二问题')).toBeInTheDocument();
  await act(async () => rejectOld(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status)));
  expect(screen.getByText('组织二问题')).toBeVisible();
  openFilters();
  expect(screen.getByLabelText('组织上下文')).toHaveValue('org-2');
  expect(screen.queryByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).not.toBeInTheDocument();
}, 30_000);

it('shows missing historical projection as unavailable, without guessing names or fetching full reports', async () => {
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...problem, dueAt: null }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  expect(row.queryByText('owner-1')).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('does not call closed deadlines overdue and uses the stable stage code over summary fields', async () => {
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status: 'CLOSED', stage: 'CLOSED' }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getByText('焊接质量科')).toBeVisible();
  expect(row.queryByText('已逾期')).not.toBeInTheDocument();
  expect(row.queryByText('分析阶段')).not.toBeInTheDocument();
});

it.each(['IN_PROGRESS', 'CLOSED', 'ARCHIVED'] as const)('uses the projected effective deadline only for active rows: %s', async status => {
  const dueAt = '2026-09-25T00:00:00.000Z';
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status, dueAt }] });
  await mount();
  const element = (await screen.findByText('正式8D划伤问题')).closest('tr')!;
  const row = within(element);
  if (status === 'IN_PROGRESS') expect(element.querySelector('time')).toHaveAttribute('datetime', dueAt);
  else expect(row.getAllByRole('cell').at(-1)).toHaveTextContent('—');
  expect(row.queryByText('已逾期')).not.toBeInTheDocument();
});

it('translates the approved stage and column labels without translating business names or requesting directories', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status: 'PENDING', stage: 'CLOSURE_REVIEW' }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getByText('焊接质量科')).toBeVisible();
  expect(row.getByText('负责人甲')).toBeVisible();
  expect(row.getByText('Closure review')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Responsible section' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});
