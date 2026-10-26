import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { ProblemCenterPage } from '../problem-center/ProblemCenterPage';
import * as api from '../problem-center/problem-center-api';

vi.mock('../problem-center/problem-center-api', () => ({
  getProblemOrganizationId: vi.fn(), getProblemIndex: vi.fn(), getProblemViews: vi.fn(),
  createProblemView: vi.fn(), updateProblemView: vi.fn(), deleteProblemView: vi.fn(),
}));
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn() }));

const problem: components['schemas']['ProblemIndexResponseDto'] = {
  id: 'problem-1', organizationId: 'org-1', reportNumber: '8D-001', domainCode: 'process-quality', problemType: 'PROCESS_DEFECT',
  sourceType: 'process-defect', sourceId: 'source-1', status: 'IN_PROGRESS', severity: 'HIGH', responsibleParty: null, ownerId: 'owner-1',
  dueAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z', version: 1,
  summary: { title: '8D-001', description: '正式8D划伤问题', domainUiKey: 'process-eight-d' },
};
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
  await act(async () => {
    render(<MemoryRouter initialEntries={[`/app/process-quality/problems${query}`]}><LanguageProvider><ProblemCenterPage processQuality /></LanguageProvider></MemoryRouter>);
  });
};

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(api.getProblemOrganizationId).mockResolvedValue('org-1');
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getProblemIndex).mockResolvedValue(result);
});

it('locks the process domain and formal response against a hostile URL and exposes no domain editor', async () => {
  await mount('?domainCode=supplier-quality&problemType=SCAR&responseForm=BRIEF');
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({ domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D' }), expect.any(AbortSignal));
  expect(screen.queryByLabelText('领域代码')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '问题类型' })).not.toBeInTheDocument();
});

it('overrides saved-view domain and type while retaining its supported status filter', async () => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [{ id: 'foreign', organizationId: 'org-1', name: '其他领域视图', version: 1, createdAt: '', updatedAt: '', configuration: {
    schemaVersion: 1, filters: { domainCode: 'supplier-quality', problemType: 'SCAR', status: 'OPEN' }, sort: { sortBy: 'updatedAt', sortDirection: 'desc' }, visibleColumns: ['reportNumber'], columnOrder: ['reportNumber'],
  } }], total: 1 });
  await mount();
  fireEvent.change(screen.getByLabelText('保存视图'), { target: { value: 'foreign' } });
  await act(async () => { fireEvent.click(screen.getByText('应用视图', { selector: 'button span' })); });
  expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({ domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D', status: 'OPEN' }), expect.any(AbortSignal));
});

it('retains the fixed formal process scope through a supported search and reset', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('报告编号检索'), { target: { value: '8D-001' } });
  fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'OPEN' } });
  await act(async () => { fireEvent.click(screen.getByText(/查\s*询/, { selector: 'button span' })); });
  expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({ domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D', search: '8D-001', status: 'OPEN' }), expect.any(AbortSignal));
  await act(async () => { fireEvent.click(screen.getByText(/重\s*置/, { selector: 'button span' })); });
  expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({ domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D' }), expect.any(AbortSignal));
  expect(vi.mocked(api.getProblemIndex).mock.lastCall?.[0]).not.toHaveProperty('search');
  expect(vi.mocked(api.getProblemIndex).mock.calls.every(([query]) => query.domainCode === 'process-quality' && query.problemType === 'PROCESS_DEFECT')).toBe(true);
});

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
  expect(row.getByText('已逾期')).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('uses server-side formal-only totals, status counts and paging rather than a client-filtered row count', async () => {
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, total: 51, statusCounts: [{ status: 'IN_PROGRESS', count: 51 }] });
  await mount();
  await screen.findByText('正式8D划伤问题');
  expect(screen.getByText(/^总数:\s*51$/)).toBeVisible();
  expect(screen.getByText(/^处理中:\s*51$/)).toBeVisible();
  expect(screen.queryByText(/旧简报/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D' }), expect.any(AbortSignal)));
});

it('bounds a long problem-description excerpt and preserves the full description as its omission hint', async () => {
  const description = `涂层失效现象${'需要核对实际批次与措施。'.repeat(40)}`;
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, items: [{ ...projectedProblem, summary: { ...projectedProblem.summary, description } }] });
  await mount();
  const row = within((await screen.findByRole('link', { name: '8D-001' })).closest('tr')!);
  const excerpt = row.getByTitle(description);
  expect(excerpt.textContent!.length).toBeLessThanOrEqual(201);
  expect(excerpt).toHaveTextContent(/^涂层失效现象/);
  expect(row.getAllByText('8D-001')).toHaveLength(1);
});

it.each([401, 403])('clears the whole scoped list when the index refresh rejects with %s', async status => {
  let reject!: (cause: unknown) => void;
  await mount();
  await screen.findByText('正式8D划伤问题');
  const refresh = screen.getByText(/刷\s*新/, { selector: 'button span' }).closest('button')!;
  expect(refresh).not.toHaveClass('ant-btn-loading');
  vi.mocked(api.getProblemIndex).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => { fireEvent.click(refresh); });
  expect(api.getProblemIndex).toHaveBeenCalledTimes(2);
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
  vi.mocked(api.getProblemIndex).mockImplementation(() => new Promise(resolve => { finishIndex = resolve; }));
  await act(async () => { fireEvent.click(refresh); });
  expect(api.getProblemIndex).toHaveBeenCalledTimes(2);
  const signal = vi.mocked(api.getProblemIndex).mock.calls[1]![1]!;
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
  expect(screen.getByText('视图甲', { selector: 'option' })).toBeInTheDocument();
  expect(screen.getByText('保存新视图', { selector: 'button span' }).closest('button')).toBeEnabled();
  expect(screen.getByText('负责人甲')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('保存视图'), { target: { value: view.id } });
  await act(async () => { fireEvent.click(screen.getByText(action === 'create' ? '保存新视图' : action === 'update' ? '更新视图' : '删除视图', { selector: 'button span' })); });
  if (action === 'delete') {
    const dialog = await screen.findByRole('tooltip');
    await act(async () => { fireEvent.click(within(dialog).getByText(/^删\s*除$/, { selector: 'button span' })); });
  }
  expect(action === 'create' ? api.createProblemView : action === 'update' ? api.updateProblemView : api.deleteProblemView).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).toBeVisible();
  expect(screen.queryByTitle('正式8D划伤问题')).not.toBeInTheDocument();
  expect(screen.queryByText('负责人甲')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '当前期限' })).not.toBeInTheDocument();
});

it.each([
  { action: 'read', status: 401 }, { action: 'read', status: 403 },
  { action: 'create', status: 401 }, { action: 'create', status: 403 },
] as const)('ignores a late denied view $action / $status from the previous organization scope', async ({ action, status }) => {
  let rejectOld!: (cause: unknown) => void;
  vi.mocked(api.getProblemIndex).mockImplementation(async query => ({ ...result, items: [{ ...projectedProblem, organizationId: query.organizationId ?? 'org-1', summary: { ...projectedProblem.summary, description: query.organizationId === 'org-2' ? '组织二问题' : '正式8D划伤问题' } }] }));
  vi.mocked(api.getProblemViews).mockImplementation(query => action === 'read' && query.organizationId === 'org-1' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve({ items: [view], total: 1 }));
  vi.mocked(api.createProblemView).mockImplementation(() => new Promise((_, reject) => { rejectOld = reject; }));
  await act(async () => { render(<MemoryRouter initialEntries={['/app/process-quality/problems?organizationId=org-1']}><LanguageProvider><ProblemCenterPage processQuality /><Link to="/app/process-quality/problems?organizationId=org-2">转到组织二</Link></LanguageProvider></MemoryRouter>); });
  expect(screen.getByText('正式8D划伤问题')).toBeInTheDocument();
  if (action === 'create') {
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
  expect(screen.getByLabelText('组织上下文')).toHaveValue('org-2');
  expect(screen.queryByText('当前会话失效或无权访问，敏感内容已清除，请重新登录或联系授权人员。')).not.toBeInTheDocument();
});

it('shows missing historical projection as unavailable, without guessing names or fetching full reports', async () => {
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, items: [problem] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  expect(row.queryByText('owner-1')).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('does not call completed or closed deadlines overdue and treats missing stage metadata as unavailable', async () => {
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status: 'CLOSED', summary: { ...projectedProblem.summary, fields: projectedProblem.summary.fields.map(field => field.key === 'stage' ? { ...field, value: null } : field) } }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getByText('焊接质量科')).toBeVisible();
  expect(row.queryByText('已逾期')).not.toBeInTheDocument();
  expect(row.queryByText('分析阶段')).not.toBeInTheDocument();
});

it.each([
  { status: 'IN_PROGRESS', analysisCompletedAt: null, submittedAt: null, label: '分析期限', expected: '2020-01-01T00:00:00.000Z' },
  { status: 'IN_PROGRESS', analysisCompletedAt: '2020-01-02T00:00:00Z', submittedAt: null, label: '完整提交期限', expected: '2020-02-01T00:00:00.000Z' },
  { status: 'PENDING', analysisCompletedAt: '2020-01-02T00:00:00Z', submittedAt: '2020-02-02T00:00:00Z', label: '关闭期限', expected: '2020-03-01T00:00:00.000Z' },
  { status: 'CLOSED', analysisCompletedAt: null, submittedAt: null, label: null, expected: null },
  { status: 'ARCHIVED', analysisCompletedAt: null, submittedAt: null, label: null, expected: null },
] as const)('uses the milestone-selected current deadline for $status / $label, never the generic problem dueAt', async ({ status, analysisCompletedAt, submittedAt, label, expected }) => {
  const values: Record<string, string | null> = { analysisCompletedAt, submittedAt, analysisDueAt: '2020-01-01T00:00:00Z', submissionDueAt: '2020-02-01T00:00:00Z', closureDueAt: '2020-03-01T00:00:00Z' };
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status, dueAt: '2099-12-31T00:00:00Z', summary: { ...projectedProblem.summary, fields: projectedProblem.summary.fields.map(field => Object.hasOwn(values, field.key) ? { ...field, value: values[field.key] ?? null } : field) } }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  const primary = row.getByRole('group', { name: '当前期限' });
  if (expected) {
    expect(within(primary).getByText(label!)).toBeVisible();
    expect(primary.querySelector('time')).toHaveAttribute('datetime', expected);
    expect(within(primary).getByText('已逾期')).toBeVisible();
  } else {
    expect(primary.querySelector('time')).toBeNull();
    expect(within(primary).getByText('—')).toBeVisible();
    expect(row.queryByText('已逾期')).not.toBeInTheDocument();
  }
  expect(row.getByText('全部阶段期限').closest('details')).not.toHaveAttribute('open');
});

it('translates the approved stage and column labels without translating business names or requesting directories', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...result, items: [{ ...projectedProblem, status: 'PENDING', summary: { ...projectedProblem.summary, fields: projectedProblem.summary.fields.map(field => field.key === 'stage' ? { ...field, value: '关闭审批中' } : field) } }] });
  await mount();
  const row = within((await screen.findByText('正式8D划伤问题')).closest('tr')!);
  expect(row.getByText('焊接质量科')).toBeVisible();
  expect(row.getByText('负责人甲')).toBeVisible();
  expect(row.getByText('Closure review')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Responsible section' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalled();
});
