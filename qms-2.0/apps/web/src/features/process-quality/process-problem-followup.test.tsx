import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProblemCenterPage } from '../problem-center/ProblemCenterPage';
import * as api from '../problem-center/problem-center-api';
import type { FollowupCondition, FollowupGroup } from '../problem-center/process-followup-filters';
import * as followupFilters from '../problem-center/process-followup-filters';
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
function addFilter(panel: ReturnType<typeof within>, index: number, field: FollowupCondition['field'], value: string, operator?: FollowupCondition['operator']) {
  fireEvent.click(panel.getByRole('button', { name: '添加筛选条件' }));
  fireEvent.change(panel.getByLabelText(`筛选字段 ${index}`), { target: { value: field } });
  if (operator) fireEvent.change(panel.getByLabelText(`筛选运算符 ${index}`), { target: { value: operator } });
  fireEvent.change(panel.getByLabelText(`筛选值 ${index}`), { target: { value } });
}
const group = (items: FollowupCondition[], logic: FollowupGroup['logic'] = 'ALL') => ({ logic, items });
const analysisFilter = group([{ field: 'stage', operator: 'EQ', value: 'ANALYSIS' }]);
it('compiles grouped status predicates into equivalent flat server filters', () => {
  const severity = { field: 'severity', operator: 'EQ', value: 'HIGH' } as const;
  const review = { field: 'stage', operator: 'EQ', value: 'CLOSURE' } as const;
  const stages = ['ANALYSIS', 'SUBMISSION', 'CLOSURE', 'CLOSURE_REVIEW', 'CLOSED', 'ARCHIVED', 'CANCELLED', 'SUSPENDED', 'FAILED', 'COMPLETED'];
  const reviewStages = ['CLOSURE', 'CLOSURE_REVIEW'];
  const complement = stages.filter(stage => !reviewStages.includes(stage));
  const predicate = (operator: 'EQ' | 'NE', stageValues: string[]): FollowupCondition[] => stageValues.map(value => ({ field: 'stage', operator, value }));
  const compile = (items: FollowupCondition[], logic: FollowupGroup['logic'] = 'ALL') => followupFilters.toServerFollowupFilters(group(items, logic));
  expect(compile([severity, review])).toEqual(group([severity, ...predicate('NE', complement)]));
  expect(compile([severity, review], 'ANY')).toEqual(group([severity, ...predicate('EQ', reviewStages)], 'ANY'));
  expect(compile([severity, { ...review, operator: 'NE' }], 'ANY')).toEqual(group([severity, ...predicate('EQ', complement)], 'ANY'));
  expect(compile([review, { ...review, operator: 'NE' }])).toEqual(group([{ field: 'stage', operator: 'EMPTY' }]));
  expect(compile([severity, review, { ...review, operator: 'NE' }], 'ANY')).toBeUndefined();
});
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
    '报告编号', '问题标题', '跟进状态', '风险', '责任板块', '负责人', '办理期限',
  ]);
  for (const header of within(table).getAllByRole('columnheader')) expect(header).toHaveStyle({ textAlign: 'center' });
  const cells = within(screen.getByText('正式8D划伤问题').closest('tr')!).getAllByRole('cell');
  cells.forEach((cell, index) => expect(cell).toHaveStyle({ textAlign: index === 1 ? 'left' : 'center' }));
  expect(screen.queryByLabelText('组织上下文')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('保存视图')).not.toBeInTheDocument();
  const status = within(table).getByRole('button', { name: '按跟进状态筛选' });
  fireEvent.click(status);
  const panel = await screen.findByRole('dialog', { name: '筛选面板' });
  const field = within(panel).getByLabelText('筛选字段 1');
  await waitFor(() => expect(field).toHaveFocus());
  expect(field).toHaveValue('stage');
  expect(field.closest('.process-quality-filter-row')).toContainElement(within(panel).getByLabelText('筛选运算符 1'));
  expect(within(panel).queryByLabelText('组织上下文')).not.toBeInTheDocument();
  expect(within(panel).queryByLabelText('保存视图')).not.toBeInTheDocument();
  expect(within(panel).queryByLabelText('排序字段')).not.toBeInTheDocument();
  expect(api.getProblemViews).not.toHaveBeenCalled();
  expect(within(field).queryByRole('option', { name: /^(报告编号|问题标题|当前环节|状态)$/ })).not.toBeInTheDocument();
  expect(within(toolbar).queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.qms-ledger')).toBe(table);
  expect(Array.from((within(panel).getByLabelText('筛选值 1') as HTMLSelectElement).options).slice(1).map(option => option.textContent)).toEqual(['待处理／分析', '待提交', '待关闭／审核', '已关闭／归档', '流程异常']);
  fireEvent.change(within(panel).getByLabelText('筛选值 1'), { target: { value: 'ANALYSIS' } });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(field, { key: 'Escape' });
  await waitFor(() => expect(status).toHaveAttribute('aria-pressed', 'true'));
  expect(status).toHaveFocus();
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ filters: JSON.stringify(analysisFilter), page: 1 }), expect.any(AbortSignal));
  openFilters();
  expect(within(await screen.findByRole('dialog')).getByLabelText('筛选值 1')).toHaveValue('ANALYSIS');
}, 30_000);

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
  </Routes><Link to="/app/process-quality/problems?organizationId=org-2">转到组织二</Link></LanguageProvider></MemoryRouter>);
  await screen.findByRole('link', { name: '8D-001' });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索报告编号或问题标题' }), { target: { value: '划伤' } });
  fireEvent.click(screen.getByRole('button', { name: 'search' }));
  openFilters();
  addFilter(within(screen.getByRole('dialog')), 1, 'stage', 'ANALYSIS');
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await screen.findByTitle('2');
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, filters: JSON.stringify(analysisFilter) }), expect.any(AbortSignal)));
  fireEvent.click(await screen.findByRole('link', { name: '8D-001' }));
  const returnLink = await screen.findByRole('link', { name: '返回制程问题跟进' });
  expect(returnLink).toHaveAttribute('href', '/app/process-quality/problems?organizationId=org-other');
  fireEvent.click(returnLink);
  await screen.findByRole('link', { name: '8D-001' });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org-other', page: 2, filters: JSON.stringify(analysisFilter), search: '划伤' }), expect.any(AbortSignal));
  expect(screen.getByRole('searchbox', { name: '搜索报告编号或问题标题' })).toHaveValue('划伤');
  fireEvent.click(screen.getByRole('link', { name: '转到组织二' }));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org-2', page: 1 }), expect.any(AbortSignal)));
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('filters');
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('search');
}, 60_000);

it('locks the process domain and formal response against a hostile URL and exposes no domain editor', async () => {
  await mount('?domainCode=supplier-quality&problemType=SCAR&responseForm=BRIEF');
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  expect(api.getProblemIndex).not.toHaveBeenCalled();
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith({ organizationId: 'org-1', page: 1, pageSize: 20, sortBy: 'updatedAt', sortDirection: 'desc' }, expect.any(AbortSignal));
  expect(screen.queryByLabelText('领域代码')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '问题类型' })).not.toBeInTheDocument();
});

it('applies ANY conditions independently of local column visibility', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '显示 跟进状态' }));
  expect(screen.queryByRole('columnheader', { name: '跟进状态' })).not.toBeInTheDocument();
  openFilters();
  const panel = within(await screen.findByRole('dialog'));
  addFilter(panel, 1, 'stage', 'CLOSURE');
  addFilter(panel, 2, 'ownerName', ' 负责人甲 ', 'NE');
  addFilter(panel, 3, 'responsibleSectionName', ' 焊接质量 ');
  fireEvent.change(panel.getByLabelText('筛选逻辑'), { target: { value: 'ANY' } });
  fireEvent.click(panel.getByRole('button', { name: '应用筛选' }));
  const expectedGroup = group([
    { field: 'ownerName', operator: 'NE', value: '负责人甲' },
    { field: 'responsibleSectionName', operator: 'CONTAINS', value: '焊接质量' },
    { field: 'stage', operator: 'EQ', value: 'CLOSURE' },
    { field: 'stage', operator: 'EQ', value: 'CLOSURE_REVIEW' },
  ], 'ANY');
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ filters: JSON.stringify(expectedGroup) }), expect.any(AbortSignal)));
  openFilters();
  const reloadedPanel = within(screen.getByRole('dialog'));
  expect(reloadedPanel.getByLabelText('筛选逻辑')).toHaveValue('ANY');
  expect(reloadedPanel.getByLabelText('筛选运算符 2')).toHaveValue('NE');
  expect(reloadedPanel.getByLabelText('筛选值 2')).toHaveValue('负责人甲');
  expect(reloadedPanel.getByLabelText('筛选值 3')).toHaveValue('焊接质量');
  expect(screen.queryByRole('columnheader', { name: '跟进状态' })).not.toBeInTheDocument();
}, 60_000);

it('combines top search with filter rows and removes an unwanted condition', async () => {
  await mount();
  const search = screen.getByRole('searchbox', { name: '搜索报告编号或问题标题' });
  fireEvent.change(search, { target: { value: '8D-001' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'search' })); });
  openFilters();
  const panel = within(await screen.findByRole('dialog'));
  expect(panel.queryByLabelText('报告编号检索')).not.toBeInTheDocument();
  expect(panel.queryByLabelText('搜索报告编号或问题标题')).not.toBeInTheDocument();
  addFilter(panel, 1, 'stage', 'ANALYSIS');
  addFilter(panel, 2, 'severity', 'HIGH');
  fireEvent.click(panel.getByRole('button', { name: '删除筛选条件 2' }));
  await act(async () => { fireEvent.click(panel.getByRole('button', { name: '应用筛选' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8D-001', filters: JSON.stringify(analysisFilter) }), expect.any(AbortSignal));
  expect(screen.getByRole('button', { name: '筛选条件' })).toHaveTextContent('筛选条件 1');
}, 60_000);

it('reveals a focused condition inside the filter rows without changing draft conditions or search', async () => {
  await mount();
  const search = screen.getByRole('searchbox', { name: '搜索报告编号或问题标题' });
  fireEvent.change(search, { target: { value: '8D-001' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'search' })); });
  const reads = vi.mocked(api.getProcessFollowup).mock.calls.length;
  openFilters();
  const dialog = await screen.findByRole('dialog');
  const panel = within(dialog);
  addFilter(panel, 1, 'stage', 'ANALYSIS');
  addFilter(panel, 2, 'severity', 'HIGH');
  const rows = dialog.querySelector<HTMLElement>('.problem-center__popup-filter-rows')!;
  Object.defineProperty(rows, 'clientHeight', { value: 64 });
  const measure = HTMLElement.prototype.getBoundingClientRect;
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === rows) return new DOMRect(0, 100, 400, 64);
    if (this.parentElement === rows) {
      const index = Array.from(rows.children).indexOf(this);
      return new DOMRect(0, 100 + index * 32 - rows.scrollTop, 400, 32);
    }
    return measure.call(this);
  });
  try {
    fireEvent.click(panel.getByRole('button', { name: '添加筛选条件' }));
    expect(panel.getByLabelText('筛选字段 3')).toHaveFocus();
    expect(rows.scrollTop).toBe(32);
    fireEvent.change(panel.getByLabelText('筛选字段 3'), { target: { value: 'dueAt' } });
    rows.scrollTop = 0;
    fireEvent.click(screen.getByRole('button', { name: '按办理期限筛选' }));
    expect(panel.getByLabelText('筛选字段 3')).toHaveFocus();
    expect(rows.scrollTop).toBe(32);
    fireEvent.click(screen.getByRole('button', { name: '按跟进状态筛选' }));
    expect(panel.getByLabelText('筛选字段 1')).toHaveFocus();
    expect(rows.scrollTop).toBe(0);
    expect(panel.getByLabelText('筛选值 1')).toHaveValue('ANALYSIS');
    expect(panel.getByLabelText('筛选值 2')).toHaveValue('HIGH');
    expect(search).toHaveValue('8D-001');
    expect(api.getProcessFollowup).toHaveBeenCalledTimes(reads);
  } finally {
    geometry.mockRestore();
  }
}, 30_000);

it('preserves top search on clearing conditions and preserves sort when restoring default filters', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '排序' }));
  const sort = within(screen.getByRole('dialog', { name: '排序' }));
  fireEvent.change(sort.getByLabelText('排序方向'), { target: { value: 'asc' } });
  fireEvent.click(sort.getByRole('button', { name: '应用排序' }));
  openFilters();
  addFilter(within(screen.getByRole('dialog')), 1, 'stage', 'ANALYSIS');
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  const search = screen.getByRole('searchbox', { name: '搜索报告编号或问题标题' });
  fireEvent.change(search, { target: { value: '划伤' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'search' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ search: '划伤', filters: JSON.stringify(analysisFilter) }), expect.any(AbortSignal));
  openFilters();
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用筛选' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ search: '划伤' }), expect.any(AbortSignal));
  expect(vi.mocked(api.getProcessFollowup).mock.lastCall?.[0]).not.toHaveProperty('filters');
  openFilters();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '恢复系统默认筛选' })); });
  expect(api.getProcessFollowup).toHaveBeenLastCalledWith({ organizationId: 'org-1', page: 1, pageSize: 20, sortBy: 'updatedAt', sortDirection: 'asc' }, expect.any(AbortSignal));
}, 120_000);

it('submits header phase and effective-deadline filters and deadline sort as one server query', async () => {
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, total: 51 });
  await mount();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '划伤' } });
  fireEvent.click(screen.getByRole('button', { name: 'search' }));
  fireEvent.click(screen.getByRole('button', { name: '按负责人筛选' }));
  const panel = within(await screen.findByRole('dialog'));
  expect(panel.getByLabelText('筛选字段 1')).toHaveFocus();
  expect(panel.getByLabelText('筛选字段 1')).toHaveValue('ownerName');
  fireEvent.change(panel.getByLabelText('筛选值 1'), { target: { value: ' 负责人甲 ' } });
  fireEvent.click(screen.getByRole('button', { name: '按责任板块筛选' }));
  expect(panel.getByLabelText('筛选字段 2')).toHaveFocus();
  expect(panel.getByLabelText('筛选字段 2')).toHaveValue('responsibleSectionName');
  fireEvent.change(panel.getByLabelText('筛选值 2'), { target: { value: ' 焊接质量 ' } });
  addFilter(panel, 3, 'stage', 'ANALYSIS');
  addFilter(panel, 4, 'dueAt', '2026-09-25T09:00', 'GTE');
  addFilter(panel, 5, 'dueAt', '2026-09-30T09:00', 'LTE');
  fireEvent.click(panel.getByLabelText('仅看当前已逾期'));
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(2);
  fireEvent.click(panel.getByRole('button', { name: '应用筛选' }));
  fireEvent.click(await screen.findByTitle('2'));
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal)));
  const sortTrigger = screen.getByRole('button', { name: '排序' });
  fireEvent.click(sortTrigger);
  const sort = within(await screen.findByRole('dialog', { name: '排序' }));
  expect(sort.queryByLabelText('筛选逻辑')).not.toBeInTheDocument();
  fireEvent.change(sort.getByLabelText('排序字段'), { target: { value: 'dueAt' } });
  fireEvent.change(sort.getByLabelText('排序方向'), { target: { value: 'asc' } });
  expect(api.getProcessFollowup).toHaveBeenCalledTimes(4);
  fireEvent.click(sort.getByRole('button', { name: '应用排序' }));
  expect(sortTrigger).toHaveFocus();
  await waitFor(() => expect(api.getProcessFollowup).toHaveBeenLastCalledWith(expect.objectContaining({
    filters: JSON.stringify(group([
      { field: 'ownerName', operator: 'CONTAINS', value: '负责人甲' },
      { field: 'responsibleSectionName', operator: 'CONTAINS', value: '焊接质量' },
      { field: 'dueAt', operator: 'GTE', value: new Date('2026-09-25T09:00').toISOString() },
      { field: 'dueAt', operator: 'LTE', value: new Date('2026-09-30T09:00').toISOString() },
      { field: 'stage', operator: 'EQ', value: 'ANALYSIS' },
    ])), overdueAt: expect.any(String), search: '划伤', sortBy: 'dueAt', sortDirection: 'asc', page: 1,
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
  expect(row.getByText('待处理／分析')).toBeVisible();
  expect(row.queryByText('已逾期')).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('keeps server pagination and shows critical risk in red without status counts', async () => {
  vi.mocked(api.getProcessFollowup).mockResolvedValue({ ...result, items: [{ ...projectedProblem, severity: 'CRITICAL' }], total: 51, statusCounts: [{ status: 'IN_PROGRESS', count: 51 }] });
  await mount();
  await screen.findByText('正式8D划伤问题');
  expect(screen.getByText(/^总数:\s*51$/)).toBeVisible();
  expect(screen.queryByText(/^处理中:\s*51$/)).not.toBeInTheDocument();
  expect(screen.getByText('重大风险')).toHaveClass('ant-tag-error');
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

it.each([401, 403])('ignores a late denied list read from the previous organization scope (%s)', async status => {
  let rejectOld!: (cause: unknown) => void;
  vi.mocked(api.getProcessFollowup).mockImplementation(async query => query.organizationId === 'org-1'
    ? new Promise((_, reject) => { rejectOld = reject; })
    : { ...result, items: [{ ...projectedProblem, organizationId: 'org-2', summary: { ...projectedProblem.summary, description: '组织二问题' } }] });
  await act(async () => { render(<MemoryRouter initialEntries={['/app/process-quality/problems?organizationId=org-1']}><LanguageProvider><ProblemCenterPage processQuality /><Link to="/app/process-quality/problems?organizationId=org-2">转到组织二</Link></LanguageProvider></MemoryRouter>); });
  const signal = vi.mocked(api.getProcessFollowup).mock.calls[0]![1]!;
  await act(async () => { fireEvent.click(screen.getByText('转到组织二')); });
  expect(signal.aborted).toBe(true);
  expect(screen.getByText('组织二问题')).toBeInTheDocument();
  await act(async () => rejectOld(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status)));
  expect(screen.getByText('组织二问题')).toBeVisible();
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
  expect(row.getByText('已关闭／归档')).toBeVisible();
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
  expect(row.getByText('Closure / review')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Responsible block' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});
