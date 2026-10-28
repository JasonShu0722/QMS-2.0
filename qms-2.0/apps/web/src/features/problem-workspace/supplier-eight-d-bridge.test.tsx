import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProblemWorkspacePage } from './ProblemWorkspacePage';

const fixture = (domainCode = 'supplier-quality', domainUiKey = 'supplier-eight-d', current = true) => ({
  problem: { id: 'index-1', sourceId: 'supplier-1', organizationId: 'org-1', reportNumber: 'INDEX-SECRET', domainCode, summary: { title: 'Outer title' } },
  domain: { summary: { title: 'Historical title', description: 'Outer sensitive description', domainUiKey }, sections: [] },
  selectedInstance: { id: 'instance-1', current }, instances: [], nodes: [],
  upgrades: [{ id: 'upgrade-1', reason: 'Sensitive upgrade', createdAt: '2026-10-28T00:00:00Z' }],
  evidence: [{ id: 'outer-file', originalName: 'Sensitive-outer.txt', sizeBytes: 12, status: 'AVAILABLE', downloadable: true }],
  actions: [{ actionKey: 'platform.upgrade', enabled: true }], capabilities: {}, task: { canClaim: true, canRelease: true },
}) as unknown as components['schemas']['ProblemWorkspaceDto'];
const report: components['schemas']['SupplierEightDReportDto'] = {
  supplierProblemId: 'supplier-1', problemId: 'index-1', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1',
  title: 'Supplier controlled report', reportNumber: 'SUPPLIER-SECRET', severity: 'LOW', status: 'PROCESSING', rowVersion: 1, contentVersion: 1, instanceVersion: 1,
  sqeUserId: 'sqe', sqeAssignmentId: 'assignment', responsibleSectionDepartmentId: 'section', submittedRevisionId: null, approvedRevisionId: null,
  analysisDueAt: null, analysisCompletedAt: null, submissionDueAt: null, submittedAt: null, closureDueAt: null, closedAt: null, releasedToSupplierAt: null,
  closure: null, allowedActions: ['read', 'save'],
  document: { description: 'Sensitive supplier document', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
    analysisProcess: '', analysisFileIds: ['inner-file'], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let workspace: ReturnType<typeof fixture>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org-1:sqe');
  workspace = fixture();
  fetcher = vi.fn(async (path: string) => json(path.includes('/workspace?') ? workspace : path.includes('/revisions?') ? { items: [], nextBefore: null }
    : path.includes('/rounds') || path.includes('deadline-extensions') ? [] : report));
  vi.stubGlobal('fetch', fetcher);
});
function mount() {
  return render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProblemWorkspacePage problemId="index-1" /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
}

it('bridges only the actual supplier domain/UI pair and uses sourceId, not the problem index id', async () => {
  mount();
  expect(await screen.findByDisplayValue('Sensitive supplier document')).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/supplier-quality/eight-d/supplier-1')).toBe(true);
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/supplier-quality/eight-d/index-1')).toBe(false);
  for (const name of ['领取任务', '释放任务', '升级预览']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});

it.each([['supplier-quality', 'supplier-quality', true], ['customer-quality', 'supplier-eight-d', true], ['supplier-quality', 'supplier-eight-d', false]])(
  'does not bridge incompatible or historical selection %s / %s / current=%s', async (domain, key, current) => {
    workspace = fixture(domain, key, current); mount(); await screen.findByText('INDEX-SECRET');
    expect(screen.queryByDisplayValue('Sensitive supplier document')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([path]) => path.startsWith('/api/v1/supplier-quality/eight-d/'))).toBe(false);
    if (!current) expect(screen.getByText('历史实例只读')).toBeVisible();
  },
);

it.each([401, 403])('clears all parent and child sensitive state on a real supplier child resource %s, aborting stale refresh', async status => {
  let release!: (value: Response) => void;
  let signal!: AbortSignal;
  let refreshing = false;
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/files/inner-file') return json({ code: 'FILE_RESOURCE_DENIED' }, status);
    if (refreshing && path.includes('/workspace?')) {
      signal = init.signal!;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return previous(path, init);
  });
  mount(); await screen.findByDisplayValue('Sensitive supplier document');
  expect(screen.getByText('Outer sensitive description')).toBeVisible();
  refreshing = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新工作空间' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('D4 分析过程附件 (1)'));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(signal.aborted).toBe(true);
  await act(async () => release(json(workspace)));
  for (const value of ['INDEX-SECRET', 'SUPPLIER-SECRET', 'Outer sensitive description', 'Sensitive-outer.txt', /Sensitive upgrade/]) expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Sensitive supplier document')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '流程实例' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新工作空间' })).toBeDisabled();
});

it.each([401, 403])('revokes parent and supplier child on outer download %s and aborts a late parent refresh', async status => {
  let release!: (value: Response) => void;
  let signal!: AbortSignal;
  let refreshing = false;
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/files/outer-file/download') return json({ code: 'FILE_RESOURCE_DENIED', message: 'unsafe download details' }, status);
    if (refreshing && path.includes('/workspace?')) {
      signal = init.signal!;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return previous(path, init);
  });
  mount(); await screen.findByDisplayValue('Sensitive supplier document');
  refreshing = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新工作空间' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '下载证据' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/files/outer-file/download', expect.objectContaining({ method: 'POST' })));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(signal.aborted).toBe(true);
  await act(async () => release(json(workspace)));
  for (const value of ['INDEX-SECRET', 'SUPPLIER-SECRET', 'Outer sensitive description', 'Sensitive-outer.txt', /Sensitive upgrade/, 'unsafe download details']) expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Sensitive supplier document')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新工作空间' })).toBeDisabled();
});

it.each([401, 403])('propagates report evidence download %s to its workspace owner', async status => {
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/files/outer-file/download') return json({ code: 'FILE_RESOURCE_DENIED' }, status);
    if (path.startsWith('/api/v1/reports/problems/')) return json({
      problem: workspace.problem, generatedAt: '2026-10-28T00:00:00Z', dataAvailability: 'AVAILABLE',
      summary: { title: 'Sensitive report title', description: 'Sensitive report body' },
      sections: [], nodes: [], evidence: workspace.evidence, upgrades: [],
    });
    return previous(path, init);
  });
  mount(); await screen.findByDisplayValue('Sensitive supplier document');
  fireEvent.click(screen.getByRole('tab', { name: '报告预览' }));
  const panel = await screen.findByRole('tabpanel', { name: /报告预览$/ });
  await within(panel).findByText('Sensitive report body');
  fireEvent.click(within(panel).getByRole('button', { name: '下载证据' }));
  await screen.findByText(/当前会话失效或无权访问/);
  for (const value of ['INDEX-SECRET', 'Sensitive report title', 'Sensitive report body', 'Sensitive-outer.txt']) expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新工作空间' })).toBeDisabled();
});
