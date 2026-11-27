import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { readAttachmentPreview } from '../attachments/attachment-preview';
import { LanguageProvider } from '../../i18n/Language';
import { EightDControlledReport } from './EightDControlledReport';
import type { EightDRead, EightDReport } from './eight-d';

vi.mock('../attachments/attachment-preview', async importOriginal => ({
  ...await importOriginal<typeof import('../attachments/attachment-preview')>(), readAttachmentPreview: vi.fn(),
}));

type Controlled = components['schemas']['ProcessEightDControlledReportDto'];
const document: EightDReport['document'] = {
  description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [],
  horizontalDeployment: [], standardization: [], closureSummary: '',
};
const report: EightDReport = {
  problemId: 'problem-1', reportNumber: '8D-001', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1',
  instanceVersion: 3, problemVersion: 2, version: 7, contentVersion: 4, status: 'CLOSED', severity: 'MEDIUM', ownerUserId: 'owner-1',
  professionalUserId: 'quality-1', responsibleSectionDepartmentId: 'section-1', collaboratorUserIds: [], document,
  analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null,
  closedRevisionId: 'revision-1', allowedActions: ['read'], sources: [],
  revisions: [{ id: 'revision-1', contentVersion: 4, recordedAt: '2026-10-25T10:00:00Z' }],
};
function saved(view: Controlled['view'], description: string): Controlled {
  return Object.assign({
    problemId: report.problemId, reportNumber: report.reportNumber, view, revisionId: view === 'CURRENT' ? null : 'revision-1',
    status: view === 'CURRENT' ? 'CLOSED_SUPPLEMENT' : view === 'APPROVED' ? 'APPROVED' : 'HISTORICAL', label: view,
    contentVersion: 4, rowVersion: 7, generatedAt: '2026-10-25T10:00:00Z', attachments: [],
    snapshot: { document: { ...document, description }, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 4,
      rowVersion: 7, ownerUserId: report.ownerUserId, professionalUserId: report.professionalUserId,
      responsibleSectionDepartmentId: report.responsibleSectionDepartmentId, collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null },
  } satisfies Controlled, { previewFingerprint: 'a'.repeat(64) });
}
function mount(read: (path: string) => Promise<Controlled>, download = vi.fn(async (_path: string) => {})) {
  const request: EightDRead = async <T,>(path: string) => await read(path) as T;
  return render(<MemoryRouter><LanguageProvider><EightDControlledReport report={report} read={request} download={download} /></LanguageProvider></MemoryRouter>);
}

it('shows D1–D8 and saved details together as a read-only document', async () => {
  const description = '第一行报告正文\n第二行报告正文';
  const current = saved('CURRENT', description);
  current.snapshot.document.correctiveActions = [{
    id: 'action-1', causeKind: 'OCCURRENCE', action: '纠正措施', owner: '责任人', plannedAt: null,
    verificationMethod: '', fileIds: [], implementationAt: null, result: '保存的实施结果', beforeState: '', afterState: '',
    firstBatch: '', followUpBatchCount: null, followUpDuration: '', verificationRecord: '', verificationFileIds: [], effective: null,
  }];
  current.snapshot.document.optionalAffectedContainment = [{
    id: 'containment-1', group: '物料', location: '供应商', quantity: 12, measure: '保存的潜在影响围堵',
    owner: '', plannedAt: null, completion: '', ngQuantity: null,
  }];
  current.snapshot.document.standardization = [{
    id: 'standardization-1', key: 'file', documentName: '标准文件', needsUpdate: false, departmentOwner: '',
    plannedAt: null, completedAt: null, status: 'NOT_APPLICABLE', reason: '保存的标准化理由',
  }];
  mount(async () => current);
  const article = within(await screen.findByRole('article', { name: '8D-001' }));
  expect(article.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent?.match(/^D[1-8](?=\s)/)?.[0]).filter(Boolean))
    .toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  expect(article.getByText('第一行报告正文 第二行报告正文').textContent).toBe(description);
  for (const detail of ['保存的实施结果', '保存的潜在影响围堵', '保存的标准化理由']) expect(article.getByText(detail)).toBeVisible();
  expect(article.queryByRole('textbox')).not.toBeInTheDocument();
});

it('shows only images whose attachment metadata matches the selected snapshot', async () => {
  const current = saved('CURRENT', '已保存正文');
  const ok: Controlled['attachments'][number] = { id: 'ok-file', originalName: '合格图.png', rendering: 'EMBEDDED', uses: ['D2 OK'], note: '',
    contentType: 'image/png', objectVersionId: 'storage-v1', sizeBytes: 72, sha256: 'b'.repeat(64), version: 2 };
  const ng = { ...ok, id: 'ng-file', originalName: '不合格图.png', uses: ['D2 NG'] };
  current.snapshot.document.okFileIds = [ok.id]; current.snapshot.document.ngFileIds = [ng.id];
  current.attachments = [ok, ng];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input);
    const file = path.endsWith(ok.id) ? ok : ng;
    return new Response(JSON.stringify({ ...file, version: file === ok ? 2 : 3, status: 'AVAILABLE', scanStatus: 'CLEAN' }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.mocked(readAttachmentPreview).mockResolvedValue({ kind: 'image', blob: new Blob([], { type: 'image/png' }) });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:report-image');
  URL.revokeObjectURL = vi.fn();
  try {
    const view = mount(async () => current);
    expect(await screen.findByRole('img', { name: ok.originalName })).toHaveAttribute('src', 'blob:report-image');
    await screen.findByText('不合格图.png · 图片预览不可用');
    expect(screen.queryByRole('img', { name: ng.originalName })).not.toBeInTheDocument();
    expect(readAttachmentPreview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: ok.id, version: 2 }), expect.any(AbortSignal), expect.any(Function));
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report-image');
  } finally {
    fetcher.mockRestore(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});

it('links the selected saved source in the authorized report organization', async () => {
  const current = saved('CURRENT', '已保存正文');
  const sourceId = 'b332f332-9a5c-4b1e-9efe-2994d10c0622';
  current.snapshot.sources = [{ sourceId, sourceVersion: 4, sourceDomain: 'process-quality', sourceType: 'process-defect',
    sourceSnapshot: { traceCode: 'TRACE-SAVED', organizationId: 'untrusted-snapshot-org' } }];
  mount(async () => current);
  fireEvent.click(await screen.findByText('查看来源明细 (1)'));
  expect(screen.getByRole('link', { name: 'TRACE-SAVED' })).toHaveAttribute('href',
    `/app/process-quality?organizationId=${report.organizationId}&defectId=${sourceId}`);
});

it('shows customer source facts from the selected saved report, never live workspace sources', async () => {
  const read: EightDRead = async <T,>(path: string) => {
    const approved = path.includes('view=APPROVED');
    const value = saved(approved ? 'APPROVED' : 'CURRENT', 'Saved content');
    value.snapshot.sources = [{ sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: 'complaint-1', sourceVersion: approved ? 2 : 3,
      sourceSnapshot: { complaintNumber: 'CQ-1', customerName: approved ? 'Approved customer' : 'Current customer',
        normalized: { defectDescription: 'Saved defect', componentCode: 'COMP-1', quantity: 2 } } }];
    return value as T;
  };
  render(<LanguageProvider><EightDControlledReport domain="customer" report={report} read={read} download={vi.fn()} /></LanguageProvider>);
  let facts = await screen.findByRole('region', { name: '来源基础信息' });
  expect(within(facts).getByText('Current customer')).toBeVisible();
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await waitFor(() => expect(screen.queryByText('Current customer')).not.toBeInTheDocument());
  facts = await screen.findByRole('region', { name: '来源基础信息' });
  expect(within(facts).getByText('Approved customer')).toBeVisible();
  expect(within(facts).getByText('保存来源版本').nextElementSibling).toHaveTextContent('2');
});

it('keeps the selected snapshot owner and section in report metadata, not in the D1 roster', async () => {
  const current = saved('CURRENT', '已保存正文');
  current.snapshot.ownerName = '流程负责人';
  current.snapshot.responsibleSectionName = '流程责任科室';
  current.snapshot.document.team = [{ id: 'team-member', name: '名册组员', department: '组员科室',
    responsibility: '验证结果', collaborationScope: '', isLeader: true }];
  mount(async () => current);
  const article = within(await screen.findByRole('article', { name: '8D-001' }));
  const roster = within(article.getByText('名册组员').closest('table')!);
  expect(roster.getByText('名册组员')).toBeVisible();
  for (const metadata of ['流程负责人', '流程责任科室']) {
    expect(article.getByText(metadata)).toBeVisible();
    expect(roster.queryByText(metadata)).not.toBeInTheDocument();
  }
});

it('ignores a late CURRENT response after switching to APPROVED', async () => {
  let release!: (value: Controlled) => void;
  const read = vi.fn((path: string) => path.includes('view=CURRENT')
    ? new Promise<Controlled>(resolve => { release = resolve; })
    : Promise.resolve(saved('APPROVED', '固定批准内容')));
  mount(read);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await screen.findByText('固定批准内容');
  await act(async () => release(saved('CURRENT', '迟到的当前内容')));
  expect(screen.queryByText('迟到的当前内容')).not.toBeInTheDocument();
  expect(screen.getByText('固定批准内容')).toBeVisible();
});

it('does not enable PDF when the server returns a different historical revision', async () => {
  const read = vi.fn(async (path: string) => path.includes('revisionId=')
    ? { ...saved('HISTORICAL', '错误的修订正文'), revisionId: 'revision-other' }
    : saved('CURRENT', '已保存正文'));
  const download = vi.fn(async (_path: string) => {});
  mount(read, download);
  await screen.findByText('已保存正文');
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-1' } });
  await screen.findByText('报告读取或下载失败，请检查权限与版本后刷新。');
  expect(screen.queryByText('错误的修订正文')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeDisabled();
  expect(download).not.toHaveBeenCalled();
});

it('does not silently substitute CURRENT for an unavailable approved report and retries the same view', async () => {
  let unavailable = true;
  const read = vi.fn(async (path: string) => {
    if (path.includes('view=APPROVED') && unavailable) throw new Error('Approved report unavailable');
    return saved(path.includes('view=APPROVED') ? 'APPROVED' : 'CURRENT', '服务端保存内容');
  });
  mount(read); await screen.findByText('服务端保存内容');
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await screen.findByText('报告读取或下载失败，请检查权限与版本后刷新。');
  expect(screen.queryByText('服务端保存内容')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeDisabled();
  unavailable = false; fireEvent.click(screen.getByRole('button', { name: '刷新报告' }));
  await screen.findByText('服务端保存内容');
  expect(read.mock.calls.at(-1)?.[0]).toContain('view=APPROVED');
});

it('downloads the exact selected historical revision with the organization scope', async () => {
  const read = vi.fn(async (path: string) => saved(path.includes('revisionId=') ? 'HISTORICAL' : 'CURRENT', path));
  const download = vi.fn(async (_path: string) => {});
  mount(read, download);
  await waitFor(() => expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-1' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  expect(download).toHaveBeenCalledWith(`/api/v1/process-quality/eight-d/problem-1/report/pdf?organizationId=org-1&revisionId=revision-1&previewFingerprint=${'a'.repeat(64)}`);
  expect(download).toHaveBeenCalledTimes(1);
});

it('keeps the preview visible after a conflict and blocks download until the refreshed snapshot arrives', async () => {
  let release!: (value: Controlled) => void;
  const read = vi.fn<(path: string) => Promise<Controlled>>()
    .mockResolvedValueOnce(saved('CURRENT', '预览时的正文'))
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const download = vi.fn<(path: string) => Promise<void>>()
    .mockRejectedValueOnce(new ApiError({ code: 'HTTP_409', message: 'Snapshot changed' }, 409))
    .mockResolvedValueOnce(undefined);
  mount(read, download);
  const getArticle = () => screen.getByRole('article', { name: '8D-001' });
  await screen.findByRole('article', { name: '8D-001' });
  const button = screen.getByRole('button', { name: '授权下载 PDF' });
  fireEvent.click(button);
  await screen.findByText('报告版本已变化，请刷新预览后下载。');
  expect(getArticle()).toBeVisible();
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '刷新报告' }));
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(button).toBeDisabled();
  await act(async () => release(Object.assign(saved('CURRENT', '刷新后的正文'), { previewFingerprint: 'b'.repeat(64) })));
  expect(getArticle()).toBeVisible();
  fireEvent.click(button);
  expect(download.mock.calls.at(-1)?.[0]).toContain(`previewFingerprint=${'b'.repeat(64)}`);
});

it('keeps the report selection and saved content when a PDF download fails', async () => {
  const read = vi.fn(async (path: string) => path.includes('revisionId=') ? saved('HISTORICAL', '历史内容不被下载失败覆盖') : saved('CURRENT', '当前保存内容'));
  const download = vi.fn(async (_path: string) => { throw new Error('PDF unavailable'); });
  mount(read, download);
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-1' } });
  await screen.findByText('历史内容不被下载失败覆盖');
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  await screen.findByText('报告读取或下载失败，请检查权限与版本后刷新。');
  expect(screen.getByLabelText('报告版本')).toHaveValue('revision-1');
  fireEvent.click(screen.getByRole('button', { name: '刷新报告' }));
  expect(await screen.findByText('历史内容不被下载失败覆盖')).toBeVisible();
});
