import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { ProblemWorkspacePage } from './ProblemWorkspacePage';
import { ProblemDomainUiProvider } from './problem-ui';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const fixture = (problemType = 'PROCESS_DEFECT', domainCode = 'process-quality', current = true, domainUiKey = 'process-eight-d') => ({
  problem: { id: 'p', organizationId: 'org', reportNumber: '8D-1', problemType, domainCode, summary: { title: '问题' } },
  domain: { summary: { title: '问题', description: '外层敏感描述', domainUiKey }, sections: [] }, selectedInstance: { id: 'i', current }, instances: [],
  upgrades: [{ id: 'upgrade-1', reason: '外层敏感升级记录', createdAt: '2026-10-25T10:00:00Z' }], nodes: [],
  evidence: [{ id: 'outer-file', originalName: '外层敏感附件名.txt', sizeBytes: 12, status: 'AVAILABLE', downloadable: true }],
  actions: [{ actionKey: 'platform.upgrade', enabled: true }], capabilities: {}, task: { canClaim: true, canRelease: true },
}) as unknown as components['schemas']['ProblemWorkspaceDto'];
const report: components['schemas']['ProcessEightDReportDto'] = {
  problemId: 'p', reportNumber: '8D-inner', organizationId: 'org', instanceId: 'i', workflowVersionId: 'flow-1', instanceVersion: 1, problemVersion: 1,
  version: 1, contentVersion: 1, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner', professionalUserId: 'quality', responsibleSectionDepartmentId: 'section',
  collaboratorUserIds: [], analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null,
  allowedActions: ['read', 'save', 'submit'], sources: [], revisions: [],
  document: { description: '内嵌敏感正文', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: ['inner-file'], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let workspace: ReturnType<typeof fixture>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:owner:org');
  workspace = fixture();
  fetcher = vi.fn(async (path: string) => response(path.includes('/workspace?') ? workspace : path.includes('/rounds') || path.includes('/requests') ? [] : report));
  vi.stubGlobal('fetch', fetcher);
});
function mount() { return render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProblemDomainUiProvider registry={{ 'process-quality': () => <p>旧通用处理</p> }}><ProblemWorkspacePage problemId="p" /></ProblemDomainUiProvider></UnsavedChangesProvider></LanguageProvider></MemoryRouter>); }
it('bridges PROCESS_DEFECT using the actual domainUiKey, suppressing legacy claim and act', async () => {
  mount();
  expect(await screen.findByRole('region', { name: '正式过程 8D 工作区' })).toBeVisible();
  expect(screen.queryByText('旧通用处理')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '领取任务' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '释放任务' })).not.toBeInTheDocument();
});
it.each([['BRIEF', 'process-quality', true], ['EIGHT_D', 'customer-quality', true], ['EIGHT_D', 'process-quality', false]])('retains compatibility for %s %s current=%s', async (type, domain, current) => {
  workspace = fixture(type, domain, current, 'process-quality'); mount(); await screen.findByText('8D-1');
  expect(screen.queryByRole('region', { name: '正式过程 8D 工作区' })).not.toBeInTheDocument();
  if (current) expect(screen.getByText('旧通用处理')).toBeVisible(); else expect(screen.getByText('历史实例只读')).toBeVisible();
});
it('does not infer a controlled workspace solely from the fixture problem type', async () => {
  workspace = fixture('EIGHT_D', 'process-quality', true, 'process-quality'); mount();
  expect(await screen.findByText('旧通用处理')).toBeVisible();
  expect(screen.queryByRole('region', { name: '正式过程 8D 工作区' })).not.toBeInTheDocument();
});

it.each([401, 403])('clears the real parent projection and aborts its in-flight refresh after SharedPanel %s', async status => {
  let release!: (value: Response) => void;
  let parentSignal!: AbortSignal;
  const previous = fetcher.getMockImplementation()!;
  let refreshing = false;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path === '/api/v1/files/inner-file') return response({ code: 'FILE_RESOURCE_DENIED', message: 'denied' }, status);
    if (refreshing && path.includes('/workspace?')) {
      parentSignal = init.signal!;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return previous(path, init);
  });
  mount(); await screen.findByDisplayValue('内嵌敏感正文');
  for (const value of ['8D-1', '外层敏感描述', '外层敏感附件名.txt', /外层敏感升级记录/]) expect(screen.getByText(value)).toBeVisible();
  refreshing = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新工作空间' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('D4 分析过程附件 (1)'));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(parentSignal.aborted).toBe(true);
  await act(async () => release(response(workspace)));
  for (const value of ['8D-1', '8D-inner', '外层敏感描述', '外层敏感附件名.txt', /外层敏感升级记录/]) expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('内嵌敏感正文')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '升级预览' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '流程实例' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新工作空间' })).toBeDisabled();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/files/inner-file')).toBe(true);
});

it('ignores a real SharedPanel late denial after the formal parent session remounts', async () => {
  let release!: (value: Response) => void;
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => path === '/api/v1/files/inner-file'
    ? new Promise<Response>(resolve => { release = resolve; }) : previous(path, init));
  mount(); await screen.findByDisplayValue('内嵌敏感正文');
  fireEvent.click(screen.getByText('D4 分析过程附件 (1)'));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-owner:org'));
  await screen.findByDisplayValue('内嵌敏感正文');
  await act(async () => release(response({ code: 'FILE_RESOURCE_DENIED' }, 403)));
  expect(screen.getByText('外层敏感描述')).toBeVisible();
  expect(screen.getByText('8D-1')).toBeVisible();
  expect(screen.queryByText(/当前会话失效或无权访问/)).not.toBeInTheDocument();
});
