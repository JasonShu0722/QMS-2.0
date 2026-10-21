import { transferableAbortController } from 'node:util';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { ProblemEvidence } from './problem-read';
import { attachmentDownload } from '../attachments/attachments';
import { ProblemUpgradePanel } from './ProblemUpgradePanel';
import { ProblemWorkspacePage } from './ProblemWorkspacePage';
import * as api from './problem-workspace-api';
import { mutateInbox } from '../tasks/task-inbox';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('./problem-workspace-api', async (original) => ({ ...await original<typeof api>(), readWorkspace: vi.fn(), readReport: vi.fn(), readProblemAudit: vi.fn(), previewUpgrade: vi.fn(), submitUpgrade: vi.fn() }));
vi.mock('../tasks/task-inbox', () => ({ mutateInbox: vi.fn() }));
vi.mock('../attachments/attachments', () => ({ attachmentDownload: vi.fn() }));
const workspace: api.ProblemWorkspace = {
  problem: { id: 'problem', organizationId: 'organization', reportNumber: 'QMS-001', domainCode: 'neutral', problemType: 'BRIEF', sourceType: 'neutral', sourceId: 'source', status: 'IN_PROGRESS', severity: 'HIGH', responsibleParty: null, ownerId: null, dueAt: null, createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z', version: 3, summary: { title: '调查事项', description: '真实问题摘要', domainUiKey: 'neutral' } },
  selectedInstance: { id: 'current', workflowVersionId: 'definition-version', version: 2, status: 'RUNNING', currentNodeId: 'node', current: true, createdAt: '2026-09-19T00:00:00Z' },
  instances: [], upgrades: [], domain: { domainVersion: 4, revisionId: 'revision', summary: { title: '调查事项', description: '真实问题摘要', domainUiKey: 'neutral' }, sections: [] }, domainAvailability: 'AVAILABLE', readOnly: true,
  nodes: [{ id: 'node', key: 'investigate', name: '调查节点', type: 'ACTION', current: true, visited: true, actionCount: 1 }], workflowActions: [],
  capabilities: { canAct: false, allowedActions: [], reasonCode: 'TASK_CLAIM_REQUIRED', currentNodeId: 'node', taskId: 'task', claimedByUserId: null, projectionPending: false },
  task: { id: 'task', version: 7, canClaim: true, canRelease: false, canRetry: false, claimedByUserId: null, instanceId: 'current', fixedVersion: 'definition-version', entryInstanceVersion: 2, nodeId: 'node', name: '调查节点', type: 'ACTION', problemId: 'problem', reportNumber: 'QMS-001', dueAt: null, status: 'PENDING', claimedAt: null, canAct: false },
  actions: [{ actionKey: 'platform.upgrade', label: '升级', enabled: true, reasonCode: null }], evidence: [],
};
function mount() { return render(<MemoryRouter initialEntries={['/app/problem-workspace/problem?organizationId=organization']}><LanguageProvider><ProblemWorkspacePage problemId="problem" /></LanguageProvider></MemoryRouter>); }
function mountGuardedWorkspace() {
  const router = createMemoryRouter([
    { path: '/app/problem-workspace/:problemId', element: <LanguageProvider><UnsavedChangesProvider><ProblemWorkspacePage problemId="problem" /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/app/problem-center', element: <p>Problem center</p> },
  ], { initialEntries: ['/app/problem-workspace/problem?organizationId=organization'] });
  return { ...render(<RouterProvider router={router} />), router };
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  vi.mocked(api.readWorkspace).mockResolvedValue(structuredClone(workspace));
});
afterEach(() => vi.unstubAllGlobals());

it('reports a denied read as an error with trace rather than empty placeholder actions', async () => {
  vi.mocked(api.readWorkspace).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'unsafe secret', traceId: 'workspace-trace' }));
  mount();
  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  expect(screen.getByText('workspace-trace')).toBeVisible();
  expect(screen.queryByText('unsafe secret')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交处理' })).not.toBeInTheDocument();
});

it('allows an eligible claim independently of read-only action capability and retains organization scope', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: '领取任务' }));
  await waitFor(() => expect(mutateInbox).toHaveBeenCalledWith('/api/v1/tasks/task/claim?organizationId=organization', 7));
  await waitFor(() => expect(api.readWorkspace).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

it('makes a historical instance read only even when a stale task advertises eligibility', async () => {
  vi.mocked(api.readWorkspace).mockResolvedValue({ ...structuredClone(workspace), selectedInstance: { ...workspace.selectedInstance, id: 'old', current: false } } as api.ProblemWorkspace);
  mount(); expect(await screen.findByText('历史实例只读')).toBeVisible();
  expect(screen.queryByRole('button', { name: '领取任务' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '升级预览' })).not.toBeInTheDocument();
});

it('keeps unavailable historical report fields explicit without copying the current workspace summary', async () => {
  vi.mocked(api.readReport).mockResolvedValue({ generatedAt: '2026-09-19T00:00:00Z', problem: workspace.problem, instance: workspace.selectedInstance, revision: null, summary: null, snapshot: null, sections: [], nodes: [], workflowActions: [], evidence: [], upgrades: [], dataAvailability: 'UNAVAILABLE', unavailableFields: ['domainRevision'] });
  mount(); fireEvent.click(await screen.findByRole('tab', { name: '报告预览' }));
  expect(await screen.findByText('历史数据不可用')).toBeVisible();
  expect(screen.queryByText('真实问题摘要')).not.toBeInTheDocument();
  expect(screen.queryByText('调查事项')).not.toBeInTheDocument();
  expect(api.readReport).toHaveBeenCalledWith('problem', 'organization', 'current', expect.objectContaining({ aborted: false }));
});

it('uses content tabs with one visible panel and mounts reads only for the selected view', async () => {
  vi.mocked(api.readReport).mockResolvedValue({ generatedAt: '2026-09-19T00:00:00Z', problem: workspace.problem, instance: workspace.selectedInstance, revision: null, summary: null, snapshot: null, sections: [], nodes: [], workflowActions: [], evidence: [], upgrades: [], dataAvailability: 'UNAVAILABLE', unavailableFields: ['domainRevision'] });
  vi.mocked(api.readProblemAudit).mockResolvedValue({ items: [], nextCursor: null, domainRevisionTrailAvailable: true });
  mount();
  const overview = await screen.findByRole('tab', { name: '问题概览' });
  const report = screen.getByRole('tab', { name: '报告预览' });
  const audit = screen.getByRole('tab', { name: '追溯' });
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(overview).toHaveAttribute('aria-selected', 'true');
  expect(report).toHaveAttribute('aria-selected', 'false');
  expect(audit).toHaveAttribute('aria-selected', 'false');
  const overviewPanel = screen.getByRole('tabpanel', { name: /问题概览$/ });
  expect(overviewPanel).toHaveAttribute('aria-labelledby', overview.id);
  expect(overview).toHaveAttribute('aria-controls', overviewPanel.id);
  expect(within(overviewPanel).getByText('真实问题摘要')).toBeVisible();
  expect(api.readReport).not.toHaveBeenCalled();
  expect(api.readProblemAudit).not.toHaveBeenCalled();

  report.focus(); fireEvent.click(report);
  expect(report).toHaveFocus();
  expect(report).toHaveAttribute('aria-selected', 'true');
  expect(overview).toHaveAttribute('aria-selected', 'false');
  // Focused Ant Design tabs include a live position announcement in their accessible name.
  const reportPanel = await screen.findByRole('tabpanel', { name: /报告预览$/ });
  expect(reportPanel).toHaveAttribute('aria-labelledby', report.id);
  expect(report).toHaveAttribute('aria-controls', reportPanel.id);
  expect(await within(reportPanel).findByText('历史数据不可用')).toBeVisible();
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  expect(screen.queryByText('真实问题摘要')).not.toBeInTheDocument();
  const reportSignal = vi.mocked(api.readReport).mock.calls[0]![3]!;

  audit.focus(); fireEvent.click(audit);
  expect(audit).toHaveFocus();
  expect(audit).toHaveAttribute('aria-selected', 'true');
  const auditPanel = await screen.findByRole('tabpanel', { name: /追溯$/ });
  expect(auditPanel).toHaveAttribute('aria-labelledby', audit.id);
  expect(audit).toHaveAttribute('aria-controls', auditPanel.id);
  expect(await within(auditPanel).findByText('暂无追溯记录')).toBeVisible();
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  expect(reportSignal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: '刷新报告' })).not.toBeInTheDocument();
  expect(api.readProblemAudit).toHaveBeenCalledWith('problem', 'organization', undefined, expect.objectContaining({ aborted: false }));

  fireEvent.click(overview);
  expect(within(await screen.findByRole('tabpanel', { name: /问题概览$/ })).getByText('真实问题摘要')).toBeVisible();
  expect(screen.queryByRole('button', { name: '刷新追溯' })).not.toBeInTheDocument();
  fireEvent.click(report);
  await waitFor(() => expect(api.readReport).toHaveBeenCalledTimes(2));
  expect(api.readWorkspace).toHaveBeenCalledTimes(1);
});

it('preserves the upgrade reason after a conflict and never automatically repeats the mutation', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [{ fieldId: 'summary', outcome: 'COPIED' }] });
  vi.mocked(api.submitUpgrade).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'unsafe', traceId: 'upgrade-trace' }));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '需要进一步分析' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  expect(await screen.findByText('记录已变化，请刷新预览后再次确认。')).toBeVisible();
  expect(screen.getByLabelText('升级原因')).toHaveValue('需要进一步分析');
  expect(api.submitUpgrade).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '确认升级' })).toBeDisabled();
});

it('guards an unsaved upgrade reason when changing workspace tabs and preserves it after cancel', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.readReport).mockResolvedValue({ generatedAt: '2026-09-19T00:00:00Z', problem: workspace.problem, instance: workspace.selectedInstance, revision: null, summary: null, snapshot: null, sections: [], nodes: [], workflowActions: [], evidence: [], upgrades: [], dataAvailability: 'UNAVAILABLE', unavailableFields: [] });
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '保留升级原因' } });
  fireEvent.click(screen.getByRole('tab', { name: '报告预览' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(api.readReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('升级原因')).toHaveValue('保留升级原因');
  expect(screen.getByRole('tab', { name: '问题概览' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: '报告预览' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(await screen.findByText('历史数据不可用')).toBeVisible();
  expect(screen.getByRole('tab', { name: '报告预览' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByLabelText('升级原因')).not.toBeInTheDocument();
});

it('blocks a workspace tab change while an upgrade request is pending', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.submitUpgrade).mockImplementation(() => new Promise<Awaited<ReturnType<typeof api.submitUpgrade>>>(() => undefined));
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '提交中的升级原因' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  await waitFor(() => expect(api.submitUpgrade).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('tab', { name: '报告预览' }));
  expect(screen.getByRole('tab', { name: '问题概览' })).toHaveAttribute('aria-selected', 'true');
  expect(api.readReport).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('switches away from an untouched upgrade preview without a discard warning', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.readProblemAudit).mockResolvedValue({ items: [], nextCursor: null, domainRevisionTrailAvailable: true });
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  await screen.findByLabelText('升级原因');
  fireEvent.click(screen.getByRole('tab', { name: '追溯' }));
  expect(await screen.findByText('暂无追溯记录')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.submitUpgrade).not.toHaveBeenCalled();
});

it.each(['关闭', '刷新工作空间'])('protects the upgrade reason on %s and only discards it after confirmation', async (action) => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '不能静默丢失的原因' } });
  const trigger = () => screen.getByRole('button', { name: action === '关闭' ? /^关\s*闭$/ : action });
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('升级原因')).toHaveValue('不能静默丢失的原因');
  expect(api.readWorkspace).toHaveBeenCalledTimes(1);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole('button', { name: action === '关闭' ? '放弃修改并关闭' : '放弃修改' }));
  await waitFor(() => expect(screen.queryByLabelText('升级原因')).not.toBeInTheDocument());
  await waitFor(() => expect(api.readWorkspace).toHaveBeenCalledTimes(action === '刷新工作空间' ? 2 : 1));
  expect(api.submitUpgrade).not.toHaveBeenCalled();
});

it('keeps the reason when refreshing a conflicted upgrade preview for explicit recovery', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.submitUpgrade).mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'unsafe' }, 409));
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '恢复时保留原因' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  expect(await screen.findByText('记录已变化，请刷新预览后再次确认。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));
  expect(await screen.findByLabelText('升级原因')).toHaveValue('恢复时保留原因');
  await waitFor(() => expect(api.previewUpgrade).toHaveBeenCalledTimes(2));
  expect(api.submitUpgrade).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps the upgrade reason after a failed task claim refresh', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(mutateInbox).mockRejectedValue(new ApiError({ code: 'TASK_CLAIM_REQUIRED', message: 'unsafe' }, 409));
  mountGuardedWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '领取失败仍保留的原因' } });
  fireEvent.click(screen.getByRole('button', { name: '领取任务' }));
  await waitFor(() => expect(api.readWorkspace).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText('升级原因')).toHaveValue('领取失败仍保留的原因');
  expect(api.submitUpgrade).not.toHaveBeenCalled();
});

it('loads the next audit cursor in the same organization and appends only the returned records', async () => {
  const audit = { id: 'event', action: 'WORKFLOW_START', outcome: 'SUCCESS', resourceType: 'WorkflowInstance', resourceId: 'current', actorName: '质量人员', actorUserId: 'user', createdAt: '2026-09-19T00:00:00Z', resourceVersion: 1, reasonCode: null };
  vi.mocked(api.readProblemAudit).mockResolvedValueOnce({ items: [audit], nextCursor: 'cursor-1', domainRevisionTrailAvailable: false }).mockResolvedValueOnce({ items: [{ ...audit, id: 'event-2', action: 'WORKFLOW_UPGRADE' }], nextCursor: null, domainRevisionTrailAvailable: true });
  mount(); fireEvent.click(await screen.findByRole('tab', { name: '追溯' }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
  expect(await screen.findByText('WORKFLOW_UPGRADE')).toBeVisible();
  expect(screen.getByText('WORKFLOW_START')).toBeVisible();
  expect(api.readProblemAudit).toHaveBeenLastCalledWith('problem', 'organization', 'cursor-1', expect.objectContaining({ aborted: false }));
});

it('retries an uncertain upgrade with the identical key and body until explicitly refreshed', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.submitUpgrade).mockRejectedValue(new TypeError('Failed to fetch'));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '需要升级分析' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  expect(await screen.findByText('结果尚未确认，重试将复用本次请求。')).toBeVisible();
  expect(screen.getByLabelText('升级原因')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  await waitFor(() => expect(api.submitUpgrade).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.submitUpgrade).mock.calls[1]).toEqual(vi.mocked(api.submitUpgrade).mock.calls[0]);
});

it('never signs a quarantined or deleted historical file even if the row is visible', () => {
  const evidence: api.ProblemReport['evidence'] = [{ id: 'file', resourceType: 'Neutral', resourceId: 'source', originalName: 'report.txt', contentType: 'text/plain', sizeBytes: 6, sha256: 'hash', status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, version: 2, uploadExpiresAt: '2026-09-19T00:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2026-09-26T00:00:00Z', downloadable: false }];
  const view = render(<LanguageProvider><ProblemEvidence evidence={evidence} /></LanguageProvider>);
  expect(screen.getByRole('button', { name: '下载证据' })).toBeDisabled();
  view.rerender(<LanguageProvider><ProblemEvidence evidence={[{ ...evidence[0]!, status: 'DELETED' }]} /></LanguageProvider>);
  expect(screen.getByRole('button', { name: '下载证据' })).toBeDisabled();
  expect(attachmentDownload).not.toHaveBeenCalled();
});

it('renders the workspace navigation and historical restriction in English', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.mocked(api.readWorkspace).mockResolvedValue({ ...workspace, selectedInstance: { ...workspace.selectedInstance!, current: false } });
  mount();
  expect(await screen.findByText('Historical instance is read only')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Report preview' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Claim task' })).not.toBeInTheDocument();
});

it('uses the historical domain title instead of the current problem title in old instance overview', async () => {
  vi.mocked(api.readWorkspace).mockResolvedValue({ ...workspace, selectedInstance: { ...workspace.selectedInstance!, current: false }, domain: { ...workspace.domain!, summary: { ...workspace.domain!.summary, title: '原简报标题' } } });
  mount();
  expect(await screen.findByRole('heading', { name: '原简报标题' })).toBeVisible();
  expect(screen.queryByText('调查事项')).not.toBeInTheDocument();
});

it.each(['IDEMPOTENCY_REPLAY', 'WORKFLOW_UPGRADE_MAPPING_INVALID'])('requires explicit recovery for a definitive %s conflict', async (code) => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  vi.mocked(api.submitUpgrade).mockRejectedValue(new ApiError({ code, message: 'unsafe' }, 409));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '升级预览' }));
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '进一步分析' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  expect(await screen.findByText('记录已变化，请刷新预览后再次确认。')).toBeVisible();
  expect(screen.getByRole('button', { name: '确认升级' })).toBeDisabled();
  expect(screen.queryByText('结果尚未确认，重试将复用本次请求。')).not.toBeInTheDocument();
});

it('does not navigate from a completed upgrade after its workspace has unmounted', async () => {
  vi.mocked(api.previewUpgrade).mockResolvedValue({ problemId: 'problem', reportNumber: 'QMS-001', canUpgrade: true, reasonCode: null, instanceId: 'current', currentNodeId: 'node', expectedProblemVersion: 3, expectedInstanceVersion: 2, expectedDomainVersion: 4, targetVersionId: 'target', targetProblemType: '8D', mappingVersion: 'v1', mappingSummary: [] });
  let complete!: (result: Awaited<ReturnType<typeof api.submitUpgrade>>) => void;
  vi.mocked(api.submitUpgrade).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const onSuccess = vi.fn();
  const view = render(<LanguageProvider><ProblemUpgradePanel problemId="problem" organizationId="organization" onSuccess={onSuccess} onClose={vi.fn()} /></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('升级原因'), { target: { value: '进一步分析' } });
  fireEvent.click(screen.getByRole('button', { name: '确认升级' }));
  await waitFor(() => expect(api.submitUpgrade).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => { complete({} as Awaited<ReturnType<typeof api.submitUpgrade>>); });
  expect(onSuccess).not.toHaveBeenCalled();
});
