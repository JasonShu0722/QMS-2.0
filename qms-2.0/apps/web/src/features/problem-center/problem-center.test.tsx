import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { ProblemCenterPage } from './ProblemCenterPage';
import * as api from './problem-center-api';

vi.mock('./problem-center-api', () => ({
  getProblemOrganizationId: vi.fn(),
  getProblemIndex: vi.fn(),
  getProblemViews: vi.fn(),
  createProblemView: vi.fn(),
  updateProblemView: vi.fn(),
  deleteProblemView: vi.fn(),
}));

const emptyPage: components['schemas']['ProblemIndexPageResponseDto'] = { items: [], total: 0, page: 1, pageSize: 25, statusCounts: [] };
const problem = (id: string, reportNumber: string): components['schemas']['ProblemIndexResponseDto'] => ({
  id,
  organizationId: 'organization-b',
  reportNumber,
  domainCode: 'supplier',
  problemType: 'SCAR',
  sourceType: 'supplier-corrective-action',
  sourceId: `${id}-source`,
  status: 'OPEN' as const,
  severity: 'HIGH',
  responsibleParty: '供应商 A',
  ownerId: null,
  dueAt: '2026-09-20T12:00:00.000Z',
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-19T12:00:00.000Z',
  version: 1,
  summary: { title: reportNumber, description: '描述', domainUiKey: 'supplier-scar' },
});
const savedView: components['schemas']['ProblemSavedViewDto'] = {
  id: 'view-1',
  organizationId: 'organization-b',
  name: '我的逾期问题',
  configuration: {
    schemaVersion: 1 as const,
    filters: { status: 'OPEN' as const, search: 'QMS-OLD' },
    sort: { sortBy: 'dueAt' as const, sortDirection: 'desc' as const },
    visibleColumns: ['reportNumber', 'status', 'dueAt'],
    columnOrder: ['reportNumber', 'status', 'dueAt'],
  },
  version: 3,
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-19T12:00:00.000Z',
};
const savedViewWithUnknownFilter = {
  ...savedView,
  configuration: {
    ...savedView.configuration,
    filters: { ...savedView.configuration.filters, injectedSql: 'drop table problems' },
  },
} as components['schemas']['ProblemSavedViewDto'];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(api.getProblemOrganizationId).mockResolvedValue('organization-a');
  vi.mocked(api.getProblemIndex).mockResolvedValue(emptyPage);
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [], total: 0 });
});

const renderPage = (path = '/app/problem-center') => render(
  <MemoryRouter initialEntries={[path]}><LanguageProvider><ProblemCenterPage /></LanguageProvider></MemoryRouter>,
);

it.each([['customer-quality', 'customer-complaint'], ['new-product-quality', 'new-product-defect-selection']])('keeps %s follow-up constrained after reset and foreign saved views', async (domainCode, sourceType) => {
  render(<MemoryRouter><LanguageProvider><ProblemCenterPage eightDDomain={domainCode as 'customer-quality' | 'new-product-quality'} /></LanguageProvider></MemoryRouter>);
  await waitFor(() => expect(api.getProblemIndex).toHaveBeenCalledWith(expect.objectContaining({ domainCode, sourceType, responseForm: 'EIGHT_D' }), expect.any(AbortSignal)));
  expect(screen.queryByLabelText('领域代码')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/重\s*置/, { selector: 'button span' }));
  fireEvent.click(screen.getByText(/查\s*询/, { selector: 'button span' }));
  await waitFor(() => expect(vi.mocked(api.getProblemIndex).mock.lastCall?.[0]).toEqual(expect.objectContaining({ domainCode, sourceType, responseForm: 'EIGHT_D' })));
});

it('uses the explicit organization query and never lets its stale response overwrite a newly selected organization', async () => {
  let resolveOld: (value: typeof emptyPage & { items: ReturnType<typeof problem>[] }) => void = () => undefined;
  vi.mocked(api.getProblemIndex).mockImplementation(({ organizationId }) => {
    if (organizationId === 'organization-b') return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve({ ...emptyPage, items: [problem('new', 'NEW-ORG')], total: 1 });
  });
  renderPage('/app/problem-center?organizationId=organization-b');
  await waitFor(() => expect(api.getProblemIndex).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'organization-b' }), expect.any(AbortSignal)));

  fireEvent.change(screen.getByLabelText('组织上下文'), { target: { value: 'organization-c' } });
  fireEvent.click(screen.getByText('切换组织', { selector: 'button span' }));
  expect((await screen.findAllByText('NEW-ORG')).length).toBeGreaterThan(0);
  resolveOld({ ...emptyPage, items: [problem('old', 'OLD-ORG')], total: 1 });

  await waitFor(() => expect(screen.queryByText('OLD-ORG')).not.toBeInTheDocument());
  expect(screen.getAllByText('NEW-ORG').length).toBeGreaterThan(0);
});

it('shows a controlled read error and trace instead of claiming the result is empty', async () => {
  vi.mocked(api.getProblemIndex).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private detail', traceId: 'problem-trace' }));
  renderPage();

  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  expect(screen.getByText('problem-trace')).toBeVisible();
  expect(screen.queryByText('暂无问题')).not.toBeInTheDocument();
});

it('restores only whitelisted saved-view filters, sorting, and visible columns', async () => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [savedViewWithUnknownFilter], total: 1 });
  vi.mocked(api.getProblemIndex).mockResolvedValue({ ...emptyPage, items: [problem('one', 'QMS-001')], total: 1 });
  renderPage('/app/problem-center?organizationId=organization-b');

  fireEvent.change(await screen.findByLabelText('保存视图'), { target: { value: 'view-1' } });
  fireEvent.click(screen.getByText('应用视图', { selector: 'button span' }));

  await waitFor(() => expect(api.getProblemIndex).toHaveBeenLastCalledWith(expect.objectContaining({
    organizationId: 'organization-b', status: 'OPEN', search: 'QMS-OLD', sortBy: 'dueAt', sortDirection: 'desc', page: 1,
  }), expect.any(AbortSignal)));
  expect(vi.mocked(api.getProblemIndex).mock.lastCall?.[0]).not.toHaveProperty('injectedSql');
  expect(screen.getByRole('columnheader', { name: '报告编号' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: '状态' })).toBeVisible();
  expect(screen.queryByRole('columnheader', { name: '标题' })).not.toBeInTheDocument();
});

it('disables saved-view writes after a scope denial', async () => {
  vi.mocked(api.getProblemViews).mockRejectedValue(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'private detail', traceId: 'scope-trace' }));
  renderPage();

  expect(await screen.findByText('无权访问该组织')).toBeVisible();
  expect(screen.getByText('scope-trace')).toBeVisible();
  expect(screen.getByRole('button', { name: '保存新视图' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '更新视图' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '删除视图' })).toBeDisabled();
});

it('keeps the local draft on a CAS conflict and reloads only when explicitly requested', async () => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [savedView], total: 1 });
  vi.mocked(api.updateProblemView).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'private detail', traceId: 'conflict-trace' }));
  renderPage('/app/problem-center?organizationId=organization-b');
  fireEvent.change(await screen.findByLabelText('保存视图'), { target: { value: 'view-1' } });
  fireEvent.click(screen.getByText('应用视图', { selector: 'button span' }));
  const search = screen.getByLabelText('报告编号检索');
  fireEvent.change(search, { target: { value: 'LOCAL-DRAFT' } });

  fireEvent.click(screen.getByText('更新视图', { selector: 'button span' }));
  expect(await screen.findByText('记录已被其他用户更新，请刷新后重试')).toBeVisible();
  expect(screen.getByText('conflict-trace')).toBeVisible();
  expect(search).toHaveValue('LOCAL-DRAFT');
  expect(api.updateProblemView).toHaveBeenCalledWith('organization-b', 'view-1', expect.objectContaining({ expectedVersion: 3 }));

  fireEvent.click(screen.getByText('重新加载保存视图', { selector: 'button span' }));
  await waitFor(() => expect(search).toHaveValue('QMS-OLD'));
});

it('keeps the newest same-scope saved-view reload when an older request finishes last', async () => {
  let resolveSlowReload: (value: { items: components['schemas']['ProblemSavedViewDto'][]; total: number }) => void = () => undefined;
  let resolveNewestReload: (value: { items: components['schemas']['ProblemSavedViewDto'][]; total: number }) => void = () => undefined;
  let viewRead = 0;
  const slowView = { ...savedView, configuration: { ...savedView.configuration, filters: { ...savedView.configuration.filters, search: 'SERVER-OLD' } } };
  const newestView = { ...savedView, version: 4, configuration: { ...savedView.configuration, filters: { ...savedView.configuration.filters, search: 'SERVER-NEW' } } };
  vi.mocked(api.getProblemViews).mockImplementation(() => {
    viewRead += 1;
    if (viewRead === 1) return Promise.resolve({ items: [savedView], total: 1 });
    if (viewRead === 2) return new Promise((resolve) => { resolveSlowReload = resolve; });
    return new Promise((resolve) => { resolveNewestReload = resolve; });
  });
  vi.mocked(api.updateProblemView).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'private detail' }));
  renderPage('/app/problem-center?organizationId=organization-b');
  fireEvent.change(await screen.findByLabelText('保存视图'), { target: { value: 'view-1' } });
  fireEvent.click(screen.getByText('应用视图', { selector: 'button span' }));
  fireEvent.click(screen.getByText('更新视图', { selector: 'button span' }));

  const reload = (await screen.findByText('重新加载保存视图', { selector: 'button span' })).closest('button')!;
  act(() => { reload.click(); reload.click(); });
  await waitFor(() => expect(api.getProblemViews).toHaveBeenCalledTimes(3));
  expect(reload).toBeDisabled();
  await act(async () => { resolveNewestReload({ items: [newestView], total: 1 }); });
  await waitFor(() => expect(screen.getByLabelText('报告编号检索')).toHaveValue('SERVER-NEW'));

  await act(async () => { resolveSlowReload({ items: [slowView], total: 1 }); });
  expect(screen.getByLabelText('报告编号检索')).toHaveValue('SERVER-NEW');
});

it('does not duplicate a pending write or render its result after switching organizations', async () => {
  let resolveCreate: (view: components['schemas']['ProblemSavedViewDto']) => void = () => undefined;
  vi.mocked(api.createProblemView).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
  renderPage('/app/problem-center?organizationId=organization-b');
  await waitFor(() => expect(api.getProblemViews).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'organization-b' }), expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText('视图名称'), { target: { value: '迟到视图' } });

  const save = screen.getByText('保存新视图', { selector: 'button span' }).closest('button')!;
  act(() => { save.click(); save.click(); });
  expect(api.createProblemView).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByLabelText('组织上下文'), { target: { value: 'organization-c' } });
  fireEvent.click(screen.getByText('切换组织', { selector: 'button span' }));
  await waitFor(() => expect(api.getProblemViews).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'organization-c' }), expect.any(AbortSignal)));
  await act(async () => { resolveCreate({ ...savedView, name: '迟到视图' }); });

  await waitFor(() => expect(screen.queryByRole('option', { name: '迟到视图' })).not.toBeInTheDocument());
  expect(screen.getByLabelText('组织上下文')).toHaveValue('organization-c');
});

it('names the personal view and explains the delete scope before sending DELETE', async () => {
  vi.mocked(api.getProblemViews).mockResolvedValue({ items: [savedView], total: 1 });
  renderPage('/app/problem-center?organizationId=organization-b');
  fireEvent.change(await screen.findByLabelText('保存视图'), { target: { value: 'view-1' } });
  fireEvent.click(screen.getByText('删除视图', { selector: 'button span' }));
  const dialog = await screen.findByRole('tooltip');
  expect(dialog).toHaveTextContent('我的逾期问题');
  expect(dialog).toHaveTextContent('个人视图');
  expect(dialog).toHaveTextContent('问题');
  fireEvent.click(within(dialog).getByRole('button', { name: /^取\s*消$/ }));
  expect(api.deleteProblemView).not.toHaveBeenCalled();
});
