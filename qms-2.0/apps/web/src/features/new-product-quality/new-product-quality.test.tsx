import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { NewProductQualityPage } from './NewProductQualityPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() };
});

const project = {
  id: 'project-1', organization_id: 'org-1', code: 'NP-2026-001', name: '电驱平台项目', product_code: 'EDRIVE-X', status: 'ACTIVE' as const, version: 2,
  stages: [{ id: 'stage-1', project_id: 'project-1', code: 'DV', name: '设计验证', status: 'OPEN' as const, version: 1 }],
  lessons: [], batches: [], selected_defects: [],
};

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(getSession).mockReset();
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', landingPath: '/app/workbench', userId: 'reviewer', organizationId: 'org-1' });
});

it('loads a project and renders its stages', async () => {
  vi.mocked(apiRequest).mockResolvedValue(project);
  render(<NewProductQualityPage />);
  fireEvent.change(screen.getByLabelText('新产品项目 ID'), { target: { value: project.id } });
  fireEvent.click(screen.getByRole('button', { name: '查看项目' }));
  expect(await screen.findByText('电驱平台项目')).toBeVisible();
  expect(screen.getByText('设计验证')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/projects/${project.id}`);
});

it('shows an explicit empty state after a successful lookup with no project', async () => {
  vi.mocked(apiRequest).mockResolvedValue(undefined as never);
  render(<NewProductQualityPage projectId="missing-project" />);
  expect(await screen.findByText('未找到新产品项目')).toBeVisible();
});

it('keeps the empty state explicit before a project is selected', () => {
  render(<NewProductQualityPage />);
  expect(screen.getByText('输入新产品项目 ID 后查看详情')).toBeVisible();
});

it('submits a mass production handover with the current project version', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockResolvedValueOnce(project).mockResolvedValueOnce({}).mockResolvedValueOnce({ ...project, status: 'ARCHIVED', version: 3 });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '量产移交' }));
  fireEvent.change(screen.getByLabelText('遗留风险说明'), { target: { value: '未关闭问题已签署风险' } });
  fireEvent.click(screen.getByRole('button', { name: '确认移交' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/projects/${project.id}/handover`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2, riskStatement: '未关闭问题已签署风险' }) })));
});

it('loads a selected trial batch report and shows metric signals', async () => {
  const batch = { id: 'batch-1', project_id: 'project-1', code: 'T1', work_order_code: null, version: 1 };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [{ id: 'metric-1', batch_id: batch.id, code: 'CPK', target: 1.33, actual: 1.41, comparison: 'GTE', source: 'MANUAL', signal: 'GREEN' }] }).mockResolvedValueOnce(null as never);
  render(<NewProductQualityPage projectId={project.id} />);

  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));

  expect(await screen.findByText('CPK')).toBeVisible();
  expect(screen.getByText('达标')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/report`);
});

it('creates a trial summary from the real report context', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  const batch = { id: 'batch-1', project_id: 'project-1', code: 'T1', work_order_code: null, version: 1 };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [{ id: 'metric-1', batch_id: batch.id, code: 'CPK', target: 1.33, actual: 1.41, comparison: 'GTE', source: 'MANUAL', signal: 'GREEN' }] }).mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 'summary-1', batchId: batch.id, projectId: project.id, conclusion: '通过', status: 'DRAFT', metricSnapshot: [], issueSnapshot: [], sourceSha256: null, version: 1, createdById: 'user-1', submittedById: null, approvedById: null, approvedAt: null, approvalNote: null });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));
  fireEvent.change(await screen.findByLabelText('试产结论'), { target: { value: '通过' } });
  fireEvent.click(screen.getByRole('button', { name: '创建总结' }));
  await waitFor(() => expect(apiRequest).toHaveBeenLastCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ conclusion: '通过' }) })));
});

it('loads a persisted trial summary and never offers a duplicate create action', async () => {
  const batch = { id: 'batch-1', project_id: 'project-1', code: 'T1', work_order_code: null, version: 1 };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockResolvedValueOnce({ id: 'summary-1', batchId: batch.id, projectId: project.id, conclusion: '已确认试产风险', status: 'APPROVED', metricSnapshot: [], issueSnapshot: [], sourceSha256: 'a'.repeat(64), version: 3, createdById: 'user-1', submittedById: 'user-1', submittedAt: '2026-09-26T00:00:00Z', approvedById: 'user-2', approvedAt: '2026-09-26T01:00:00Z', approvalNote: '批准' });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));
  expect((await screen.findAllByText('已确认试产风险'))[0]).toBeVisible();
  expect(screen.queryByRole('button', { name: '创建总结' })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary`);
  expect(screen.getByRole('button', { name: '下载 Excel' })).toBeVisible();
  expect(screen.getByRole('button', { name: '下载 PDF' })).toBeVisible();
});

it('downloads the current approved version with credentials', async () => {
  const batch = { id: 'batch-download', project_id: project.id, code: 'RUN', work_order_code: null, version: 1 };
  const approved = { id: 'summary-download', batchId: batch.id, projectId: project.id, conclusion: '批准', status: 'APPROVED', metricSnapshot: [], issueSnapshot: [], sourceSha256: 'a'.repeat(64), version: 3, createdById: 'author', submittedById: 'author', approvedById: 'reviewer' };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockResolvedValueOnce(approved);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['PK']), headers: new Headers({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 RUN' }));
  fireEvent.click(await screen.findByRole('button', { name: '下载 Excel' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary/export/xlsx?expectedVersion=3`, expect.objectContaining({ credentials: 'include' })));
  expect(anchorClick).toHaveBeenCalled();
  anchorClick.mockRestore();
  vi.unstubAllGlobals();
});

it('records a reviewer rejection and offers a versioned revision', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  const batch = { id: 'batch-review', project_id: project.id, code: 'REVIEW', work_order_code: null, version: 1 };
  const submitted = { id: 'summary-review', batchId: batch.id, projectId: project.id, conclusion: '初稿', status: 'SUBMITTED', metricSnapshot: [], issueSnapshot: [], sourceSha256: 'a'.repeat(64), version: 2, createdById: 'author', submittedById: 'author', submittedAt: '2026-09-26T00:00:00Z', approvedById: null, approvedAt: null, approvalNote: null };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockResolvedValueOnce(submitted).mockResolvedValueOnce({ ...submitted, status: 'REJECTED', version: 3, approvalNote: '补充验证' }).mockResolvedValueOnce({ ...submitted, status: 'DRAFT', version: 4, conclusion: '补充后通过', sourceSha256: null });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 REVIEW' }));
  fireEvent.change(await screen.findByLabelText('试产总结审批意见'), { target: { value: '补充验证' } });
  fireEvent.click(screen.getByRole('button', { name: '驳回总结' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary/decision`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 2, decision: 'REJECT', note: '补充验证' }) })));
  fireEvent.change(await screen.findByLabelText('修订试产结论'), { target: { value: '补充后通过' } });
  fireEvent.click(screen.getByRole('button', { name: '修订总结' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary/revise`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 3, conclusion: '补充后通过' }) })));
});

it('shows the submitter a separate-reviewer hint without decision controls', async () => {
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', landingPath: '/app/workbench', userId: 'author', organizationId: 'org-1' });
  const batch = { id: 'batch-self', project_id: project.id, code: 'SELF', work_order_code: null, version: 1 };
  const submitted = { id: 'summary-self', batchId: batch.id, projectId: project.id, conclusion: '待审批', status: 'SUBMITTED', metricSnapshot: [], issueSnapshot: [], sourceSha256: 'a'.repeat(64), version: 2, createdById: 'author', submittedById: 'author', approvedById: null, approvalNote: null };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockResolvedValueOnce(submitted);
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 SELF' }));
  expect(await screen.findByText('试产总结需由其他审批人处理')).toBeVisible();
  expect(screen.queryByRole('button', { name: '批准总结' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '驳回总结' })).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('/summary/decision'), expect.anything());
});

it('offers revision of an approved summary and returns it to draft for another approval', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  const batch = { id: 'batch-approved', project_id: project.id, code: 'APPROVED', work_order_code: null, version: 1 };
  const approved = { id: 'summary-approved', batchId: batch.id, projectId: project.id, conclusion: '原结论', status: 'APPROVED', metricSnapshot: [], issueSnapshot: [], sourceSha256: 'a'.repeat(64), version: 3, createdById: 'author', submittedById: 'author', approvedById: 'reviewer', approvalNote: '已批准' };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockResolvedValueOnce(approved).mockResolvedValueOnce({ ...approved, status: 'DRAFT', version: 4, conclusion: '更新结论', sourceSha256: null, submittedById: null, approvedById: null });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 APPROVED' }));
  fireEvent.change(await screen.findByLabelText('修订试产结论'), { target: { value: '更新结论' } });
  fireEvent.click(screen.getByRole('button', { name: '修订总结' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${batch.id}/summary/revise`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 3, conclusion: '更新结论' }) })));
  expect(await screen.findByRole('button', { name: '提交审批' })).toBeVisible();
});

it('keeps summary actions closed when the summary read is denied', async () => {
  const batch = { id: 'batch-1', project_id: 'project-1', code: 'T1', work_order_code: null, version: 1 };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [batch] }).mockResolvedValueOnce({ ...batch, metrics: [] }).mockRejectedValueOnce({ status: 403, code: 'FEATURE_PERMISSION_DENIED' });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));
  expect(await screen.findByText('暂无试产总结访问权限')).toBeVisible();
  expect(screen.queryByRole('button', { name: '创建总结' })).not.toBeInTheDocument();
});

it('ignores a late summary response after switching to another batch', async () => {
  const first = { id: 'batch-1', project_id: 'project-1', code: 'T1', work_order_code: null, version: 1 };
  const second = { ...first, id: 'batch-2', code: 'T2' };
  let resolveFirst!: (value: unknown) => void;
  const firstSummary = new Promise((resolve) => { resolveFirst = resolve; });
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...project, batches: [first, second] })
    .mockResolvedValueOnce({ ...first, metrics: [] }).mockImplementationOnce(() => firstSummary as never)
    .mockResolvedValueOnce({ ...second, metrics: [] }).mockResolvedValueOnce(null as never);
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/trial-batches/${first.id}/summary`));
  fireEvent.click(screen.getByRole('button', { name: '查看试产报告 T2' }));
  expect(await screen.findByText('试产报告 · T2')).toBeVisible();
  resolveFirst({ id: 'summary-1', batchId: first.id, projectId: project.id, conclusion: '旧批次结论', status: 'APPROVED', metricSnapshot: [], issueSnapshot: [], sourceSha256: null, version: 2 });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建总结' })).toBeVisible());
  expect(screen.queryByText('旧批次结论')).not.toBeInTheDocument();
});

it('creates an early flow plan from the project page', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  const earlyFlow = { id: 'flow-1', organizationId: 'org-1', projectId: project.id, monitoringWindowDays: 30, plan: '每日首件确认', status: 'DRAFT' as const, approvalNote: null, version: 1, submittedById: null, submittedAt: null, approvedById: null, approvedAt: null, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z' };
  vi.mocked(apiRequest).mockResolvedValueOnce(project).mockResolvedValueOnce(earlyFlow).mockResolvedValueOnce({ ...project, early_flow: earlyFlow });
  render(<NewProductQualityPage projectId={project.id} />);
  fireEvent.click(await screen.findByRole('button', { name: '创建方案' }));
  fireEvent.change(screen.getByLabelText('监控方案'), { target: { value: '每日首件确认' } });
  fireEvent.change(screen.getByLabelText('监控频次'), { target: { value: '每日' } });
  fireEvent.change(screen.getByLabelText('退出条件'), { target: { value: '连续三批合格' } });
  fireEvent.click(screen.getByRole('button', { name: '保存方案' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/projects/${project.id}/early-flow`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ monitoringWindowDays: 30, monitoringFrequency: '每日', plan: '每日首件确认', exitCriteria: '连续三批合格' }) })));
});
