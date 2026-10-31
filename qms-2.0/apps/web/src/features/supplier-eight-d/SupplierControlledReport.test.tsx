import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { SupplierControlledReport } from './SupplierControlledReport';

type Controlled = components['schemas']['SupplierEightDControlledReportDto'];
type Report = components['schemas']['SupplierEightDReportDto'];
const document: Report['document'] = {
  description: '已保存正文', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [],
  horizontalDeployment: [], standardization: [], closureSummary: '',
};
const outer: Report = {
  supplierProblemId: 'supplier-1', problemId: 'problem-1', organizationId: 'org-1', instanceId: 'outer-instance', workflowVersionId: 'flow-1',
  reportNumber: 'OUTER-CURRENT', title: '外层当前事实不得回填', severity: 'CRITICAL', status: 'CLOSED', rowVersion: 99, contentVersion: 99, instanceVersion: 99,
  sqeUserId: 'outer-sqe', sqeAssignmentId: 'assignment-1', responsibleSectionDepartmentId: 'section-1', document,
  submittedRevisionId: 'latest', approvedRevisionId: 'latest', analysisDueAt: '2099-01-01T00:00:00Z', analysisCompletedAt: '2099-01-02T00:00:00Z',
  submissionDueAt: '2099-01-03T00:00:00Z', submittedAt: '2099-01-04T00:00:00Z', closureDueAt: '2099-01-05T00:00:00Z', closedAt: '2099-01-06T00:00:00Z',
  releasedToSupplierAt: null, allowedActions: ['report'],
  closure: { id: 'outer-round', problemId: 'problem-1', instanceId: 'outer-instance', workflowVersionId: 'outer-flow', roundNumber: 99,
    status: 'APPROVED', contentVersion: 99, version: 99, createdAt: '2099-01-07T00:00:00Z', updatedAt: '2099-01-08T00:00:00Z', duties: [] },
};

function fixture(view: Controlled['view'], month: string, contentVersion: number): Controlled {
  const timestamp = (day: string) => `2026-${month}-${day}T08:00:00Z`;
  const status = view === 'APPROVED' ? 'APPROVED' : view === 'HISTORICAL' ? 'HISTORICAL' : 'CLOSED_SUPPLEMENT';
  return {
    supplierProblemId: 'supplier-1', problemId: 'problem-1', reportNumber: `SQ-${view}`, view,
    revisionId: view === 'CURRENT' ? null : `revision-${view}`, status, label: `所选${view}版`, contentVersion, rowVersion: contentVersion + 10,
    generatedAt: '2026-10-28T09:10:11Z', attachments: [],
    snapshot: {
      document: { ...document, description: `${view}版正文` }, sources: [],
      problem: { reportNumber: `SQ-${view}`, title: `${view}版问题`, materialCode: `MAT-${view}`, materialCategory: 'ELECTRONIC',
        defectDescription: `${view}版不良事实`, defectQuantity: view === 'CURRENT' ? 0 : contentVersion, severity: 'HIGH',
        createdAt: timestamp('01'), closedAt: timestamp('07'), ...(view === 'CURRENT' ? { supplementUpdatedAt: timestamp('12') } : {}) },
      instance: { id: `instance-${view}`, version: contentVersion + 20, status: 'COMPLETED' },
      deadlines: { analysisDueAt: timestamp('02'), submissionDueAt: timestamp('04'), closureDueAt: timestamp('06') },
      contentVersion, rowVersion: contentVersion + 10, ownerUserId: null, professionalUserId: 'saved-sqe',
      responsibleSectionDepartmentId: 'saved-section', collaboratorUserIds: [], analysisCompletedAt: timestamp('03'), submittedAt: timestamp('05'),
      approvalRounds: [{ id: `round-${view}`, roundNumber: contentVersion, status: view === 'HISTORICAL' ? 'RETURNED' : 'APPROVED',
        contentVersion, version: contentVersion + 30, createdAt: timestamp('08'), updatedAt: timestamp('10'),
        duties: [{ id: `duty-${view}`, duty: 'PROFESSIONAL', status: view === 'HISTORICAL' ? 'CANCELLED' : 'APPROVED',
          userId: `assignee-${view}`, decidedBy: `decider-${view}`, decidedAt: timestamp('09'), comment: `${view}内部意见` }] }],
    },
  };
}

let values: Record<string, Controlled>;
let fetcher: ReturnType<typeof vi.fn>;
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function mount(portal = false) {
  return render(<ConfigProvider><LanguageProvider><SupplierControlledReport report={outer}
    base={`/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d/supplier-1`} portal={portal} read={apiRequest} /></LanguageProvider></ConfigProvider>);
}
function fact(region: HTMLElement, label: string, value: string) {
  const term = within(region).getByText(label, { selector: 'dt' });
  expect(term.nextElementSibling).toHaveTextContent(value);
}
beforeEach(() => {
  vi.unstubAllGlobals(); localStorage.clear();
  values = { CURRENT: fixture('CURRENT', '10', 7), APPROVED: fixture('APPROVED', '09', 4), 'revision-HISTORICAL': fixture('HISTORICAL', '08', 2) };
  fetcher = vi.fn(async (path: string) => {
    if (path.includes('/revisions?')) return json({ items: [{ id: 'revision-HISTORICAL', revision: 2, createdAt: '2026-08-01T08:00:00Z', approved: false }], nextBefore: null });
    if (path.includes('/report?')) {
      const query = new URL(path, 'http://localhost').searchParams;
      return json(values[query.get('revisionId') ?? query.get('view')!]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
});

it.each([false, true])('keeps saved-version guidance in the portal only (portal=%s)', async portal => {
  if (portal) values.CURRENT = values.APPROVED;
  mount(portal);
  await screen.findByDisplayValue(portal ? 'APPROVED版正文' : 'CURRENT版正文');
  expect(screen.queryByText(/报告只含服务端已保存内容/) !== null).toBe(portal);
  expect(screen.getByRole('region', { name: '所选版本基础事实' })).toBeVisible();
  expect(screen.getByRole('button', { name: '授权下载 PDF' })).toBeEnabled();
});

it('binds CURRENT, APPROVED and historical facts, dates and closure duties to the selected snapshot, never the outer current report', async () => {
  mount();
  for (const selection of ['CURRENT', 'APPROVED', 'revision-HISTORICAL']) {
    if (selection !== 'CURRENT') fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: selection } });
    const selected = values[selection], snapshot = selected.snapshot;
    expect(await screen.findByDisplayValue(`${selected.view}版正文`)).toBeDisabled();
    const facts = screen.getByRole('region', { name: '所选版本基础事实' });
    fact(facts, '报告单号', selected.reportNumber); fact(facts, '标题', `${selected.view}版问题`);
    fact(facts, '物料编码', `MAT-${selected.view}`); fact(facts, '物料类别', 'ELECTRONIC');
    fact(facts, '不良描述', `${selected.view}版不良事实`); fact(facts, '不良数量', String(snapshot.problem.defectQuantity));
    fact(facts, '风险等级', 'HIGH'); fact(facts, '创建时间', String(snapshot.problem.createdAt));
    const dates = screen.getByRole('region', { name: '所选版本阶段时间' });
    for (const [label, value] of [
      ['分析计划', snapshot.deadlines.analysisDueAt], ['分析完成', snapshot.analysisCompletedAt],
      ['完整提交计划', snapshot.deadlines.submissionDueAt], ['完整提交时间', snapshot.submittedAt],
      ['关闭计划', snapshot.deadlines.closureDueAt], ['实际关闭时间', snapshot.problem.closedAt],
    ]) fact(dates, String(label), String(value));
    const basis = screen.getByRole('region', { name: '所选版本审批与关闭依据' });
    fact(basis, '修订标识', selected.revisionId ?? '未记录'); fact(basis, '正文版本', String(snapshot.contentVersion));
    fact(basis, '数据版本', String(snapshot.rowVersion)); fact(basis, '流程版本', String(snapshot.instance.version));
    const round = within(basis).getByRole('region', { name: `审批轮次 ${selected.contentVersion}` });
    const savedRound = snapshot.approvalRounds![0];
    fact(round, '轮次结果', String(savedRound.status)); fact(round, '固定正文版本', String(savedRound.contentVersion));
    fact(round, '轮次版本', String(savedRound.version)); fact(round, '发起时间', String(savedRound.createdAt));
    fact(round, '轮次更新时间', String(savedRound.updatedAt));
    const duty = within(round).getByRole('region', { name: '审批职责 1' });
    const savedDuty = (savedRound.duties as Record<string, unknown>[])[0];
    fact(duty, '职责', 'PROFESSIONAL'); fact(duty, '职责结果', String(savedDuty.status)); fact(duty, '确认时间', String(savedDuty.decidedAt));
    fact(duty, '职责用户标识', String(savedDuty.userId)); fact(duty, '确认用户标识', String(savedDuty.decidedBy)); fact(duty, '意见', `${selected.view}内部意见`);
    expect(screen.queryByText('外层当前事实不得回填')).not.toBeInTheDocument();
    expect(basis).not.toHaveTextContent('outer-round'); expect(dates).not.toHaveTextContent('2099-');
    for (const other of Object.values(values).filter(value => value !== selected)) expect(facts).not.toHaveTextContent(`MAT-${other.view}`);
    if (selection === 'CURRENT') {
      fact(screen.getByRole('region', { name: '内部补充版本说明' }), '补充更新时间', String(snapshot.problem.supplementUpdatedAt));
      expect(screen.getByText('关闭后内部补充，非原批准版，不对供应商公开。')).toBeVisible();
    } else expect(screen.queryByRole('region', { name: '内部补充版本说明' })).not.toBeInTheDocument();
  }
});

it('shows unapproved and unrecorded values honestly instead of borrowing the outer approved closure or generated time', async () => {
  const current = values.CURRENT;
  current.status = 'DRAFT'; current.snapshot.approvalRounds = [];
  current.snapshot.deadlines = { analysisDueAt: null, submissionDueAt: null, closureDueAt: null };
  current.snapshot.analysisCompletedAt = null; current.snapshot.submittedAt = null; current.snapshot.problem.closedAt = null;
  mount(); await screen.findByDisplayValue('CURRENT版正文');
  expect(screen.getByText('本版无批准记录（未批准）')).toBeVisible();
  const dates = screen.getByRole('region', { name: '所选版本阶段时间' });
  expect(within(dates).getAllByText('未记录')).toHaveLength(6);
  expect(dates).not.toHaveTextContent(current.generatedAt); expect(dates).not.toHaveTextContent('2099-');
  expect(screen.queryByRole('region', { name: '内部补充版本说明' })).not.toBeInTheDocument();
});

it('accepts a saved approval record when approvalRounds is absent and does not substitute present-day rounds', async () => {
  values.CURRENT.snapshot.approval = values.CURRENT.snapshot.approvalRounds![0];
  delete values.CURRENT.snapshot.approvalRounds;
  mount(); await screen.findByDisplayValue('CURRENT版正文');
  const round = screen.getByRole('region', { name: '审批轮次 7' });
  fact(round, '固定正文版本', '7');
  expect(within(round).getByText('CURRENT内部意见')).toBeVisible();
});

it('does not use generatedAt as a missing supplement update time', async () => {
  values.CURRENT.snapshot.problem.supplementUpdatedAt = null;
  mount(); await screen.findByDisplayValue('CURRENT版正文');
  const supplement = screen.getByRole('region', { name: '内部补充版本说明' });
  fact(supplement, '补充更新时间', '未记录');
  expect(supplement).not.toHaveTextContent(values.CURRENT.generatedAt);
});

it('shows only portal-safe returned facts and duty results without internal identities, opinions or arbitrary metadata', async () => {
  const selected = fixture('APPROVED', '09', 4);
  delete (selected.snapshot.approvalRounds![0].duties as Record<string, unknown>[])[0].comment;
  selected.snapshot.problem.internalMemo = '未白名单内部资料';
  selected.snapshot.instance.internalMemo = '未白名单内部流程';
  selected.snapshot.sources = [{ sourceDomain: 'process', sourceType: 'internal', sourceId: 'secret-source', sourceVersion: 1, sourceSnapshot: { note: '内部来源' } }];
  values.CURRENT = selected;
  mount(true); await screen.findByDisplayValue('APPROVED版正文');
  fact(screen.getByRole('region', { name: '所选版本基础事实' }), '物料编码', 'MAT-APPROVED');
  const duty = screen.getByRole('region', { name: '审批职责 1' });
  fact(duty, '职责结果', 'APPROVED'); fact(duty, '确认时间', '2026-09-09T08:00:00Z');
  for (const value of ['assignee-APPROVED', 'decider-APPROVED', 'outer-sqe', '未白名单内部资料', '未白名单内部流程', '内部来源']) {
    expect(screen.queryByText(value)).not.toBeInTheDocument();
  }
  expect(within(duty).queryByText('意见')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '内部补充版本说明' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(([path]) => String(path).startsWith('/api/v1/supplier-portal/'))).toBe(true);
});

it('clears old metadata immediately on selection change and ignores a late aborted selected report', async () => {
  let resolveApproved!: (value: Response) => void;
  let approvedSignal: AbortSignal | undefined;
  const normal = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path: string, init: RequestInit = {}) => {
    if (path.endsWith('/report?view=APPROVED')) {
      approvedSignal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { resolveApproved = resolve; });
    }
    return normal(path, init);
  });
  mount(); await screen.findByDisplayValue('CURRENT版正文');
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'APPROVED' } });
  expect(screen.queryByRole('region', { name: '所选版本基础事实' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: 'revision-HISTORICAL' } });
  await screen.findByDisplayValue('HISTORICAL版正文');
  expect(approvedSignal?.aborted).toBe(true);
  await act(async () => { resolveApproved(json(values.APPROVED)); });
  expect(screen.getByRole('region', { name: '所选版本基础事实' })).toHaveTextContent('MAT-HISTORICAL');
  expect(screen.queryByText('MAT-APPROVED')).not.toBeInTheDocument();
});
