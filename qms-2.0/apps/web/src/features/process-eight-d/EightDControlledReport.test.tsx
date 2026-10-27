import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { EightDControlledReport } from './EightDControlledReport';
import type { EightDRead, EightDReport } from './eight-d';

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
  return {
    problemId: report.problemId, reportNumber: report.reportNumber, view, revisionId: view === 'CURRENT' ? null : 'revision-1',
    status: view === 'CURRENT' ? 'CLOSED_SUPPLEMENT' : view === 'APPROVED' ? 'APPROVED' : 'HISTORICAL', label: view,
    contentVersion: 4, rowVersion: 7, generatedAt: '2026-10-25T10:00:00Z', attachments: [],
    snapshot: { document: { ...document, description }, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 4,
      rowVersion: 7, ownerUserId: report.ownerUserId, professionalUserId: report.professionalUserId,
      responsibleSectionDepartmentId: report.responsibleSectionDepartmentId, collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null },
  };
}
function mount(read: (path: string) => Promise<Controlled>, download = vi.fn(async (_path: string) => {})) {
  const request: EightDRead = async <T,>(path: string) => await read(path) as T;
  return render(<LanguageProvider><EightDControlledReport report={report} read={request} download={download} /></LanguageProvider>);
}

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

it('ignores a late CURRENT response after switching to APPROVED', async () => {
  let release!: (value: Controlled) => void;
  const read = vi.fn((path: string) => path.includes('view=CURRENT')
    ? new Promise<Controlled>(resolve => { release = resolve; })
    : Promise.resolve(saved('APPROVED', '固定批准内容')));
  mount(read);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await screen.findByDisplayValue('固定批准内容');
  await act(async () => release(saved('CURRENT', '迟到的当前内容')));
  expect(screen.queryByDisplayValue('迟到的当前内容')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('固定批准内容')).toBeVisible();
});

it('does not silently substitute CURRENT for an unavailable approved report and retries the same view', async () => {
  let unavailable = true;
  const read = vi.fn(async (path: string) => {
    if (path.includes('view=APPROVED') && unavailable) throw new Error('Approved report unavailable');
    return saved(path.includes('view=APPROVED') ? 'APPROVED' : 'CURRENT', '服务端保存内容');
  });
  mount(read); await screen.findByDisplayValue('服务端保存内容');
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  await screen.findByText('报告读取或下载失败，请检查权限与版本后刷新。');
  expect(screen.queryByDisplayValue('服务端保存内容')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeDisabled();
  unavailable = false; fireEvent.click(screen.getByRole('button', { name: '刷新报告' }));
  await screen.findByDisplayValue('服务端保存内容');
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
  expect(download).toHaveBeenCalledWith('/api/v1/process-quality/eight-d/problem-1/report/pdf?organizationId=org-1&revisionId=revision-1');
  expect(download).toHaveBeenCalledTimes(1);
});

it('keeps the report selection and saved content when a PDF download fails', async () => {
  const read = vi.fn(async () => saved('HISTORICAL', '历史内容不被下载失败覆盖'));
  const download = vi.fn(async (_path: string) => { throw new Error('PDF unavailable'); });
  mount(read, download);
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-1' } });
  await screen.findByDisplayValue('历史内容不被下载失败覆盖');
  fireEvent.click(screen.getByRole('button', { name: '授权下载 PDF' }));
  await screen.findByText('报告读取或下载失败，请检查权限与版本后刷新。');
  expect(screen.getByLabelText('报告版本')).toHaveValue('revision-1');
  fireEvent.click(screen.getByRole('button', { name: '刷新报告' }));
  expect(await screen.findByDisplayValue('历史内容不被下载失败覆盖')).toBeVisible();
});
