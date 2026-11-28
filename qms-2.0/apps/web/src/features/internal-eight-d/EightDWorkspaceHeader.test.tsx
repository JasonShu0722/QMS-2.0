import { ConfigProvider } from 'antd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { components } from '@qms/contracts';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessEightDWorkspace } from '../process-eight-d/ProcessEightDWorkspace';
import { SupplierEightDWorkspace } from '../supplier-eight-d/SupplierEightDWorkspace';
import { EightDWorkspaceHeader } from './EightDWorkspaceHeader';

const dates = {
  analysisDueAt: '2026-11-24T10:00:00Z', analysisCompletedAt: '2026-11-24T08:00:00Z',
  submissionDueAt: '2026-11-26T10:00:00Z', submittedAt: null, closureDueAt: '2026-11-28T10:00:00Z',
};
const document: components['schemas']['ProcessEightDDocumentDto'] = {
  title: '焊接强度不足', description: '焊接工艺问题', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '',
};
const identifiers = { problemId: 'problem-1', reportNumber: '8D-001', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', instanceVersion: 3, contentVersion: 4 };
const internal: components['schemas']['ProcessEightDReportDto'] = {
  ...identifiers, ...dates, problemVersion: 2, version: 7, status: 'PROCESSING', severity: 'MEDIUM',
  ownerUserId: 'owner-id', ownerName: '工艺负责人', professionalUserId: 'reviewer-id', responsibleSectionDepartmentId: 'section-id', responsibleSectionName: '制程质量科',
  currentNodeName: '原因分析', collaboratorUserIds: [], document, closedRevisionId: null, allowedActions: ['read'], sources: [], revisions: [],
};
const supplier: components['schemas']['SupplierEightDReportDto'] = {
  ...identifiers, ...dates, supplierProblemId: 'supplier-1', rowVersion: 7, title: '来料焊接缺陷', status: 'PENDING', severity: 'HIGH',
  sqeUserId: 'sqe-id', sqeAssignmentId: 'assignment-id', responsibleSectionDepartmentId: 'supplier-section-id', document,
  submittedRevisionId: null, approvedRevisionId: null, closedAt: null, releasedToSupplierAt: null, closure: null, allowedActions: ['read'],
};

beforeEach(() => {
  localStorage.clear();
  useWorkTabsStore.getState().reset();
});
afterEach(() => vi.unstubAllGlobals());

function mount(report: typeof internal | typeof supplier, workspace: React.ReactNode) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(report), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><UnsavedChangesProvider>{workspace}</UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>);
  return fetcher;
}

const showPlans = async () => {
  const trigger = screen.getByRole('button', { name: '责任与计划' });
  expect(screen.queryByRole('table', { name: '计划与实际' })).toBeNull();
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '责任与计划' });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
};

it.each([
  ['OPEN', '待处理', 'Open'],
  ['IN_PROGRESS', '办理中', 'Processing'],
  ['PENDING', '审批中', 'In review'],
  ['RESOLVED', '已解决', 'Resolved'],
  ['CLOSED', '已关闭', 'Closed'],
  ['ARCHIVED', '已归档', 'Archived'],
  ['PROCESSING', '办理中', 'Processing'],
  ['IN_REVIEW', '审批中', 'In review'],
  ['FUTURE_STATUS', 'FUTURE_STATUS', 'FUTURE_STATUS'],
])('localizes the shared header status %s', (status, chinese, english) => {
  const heading = <EightDWorkspaceHeader title="8D" actions={null} report={{ ...internal, status }} plansOpen={false} onPlansOpenChange={vi.fn()} />;
  const chineseView = render(<LanguageProvider>{heading}</LanguageProvider>);
  expect(chineseView.getByText(chinese)).toBeVisible();
  chineseView.unmount();
  localStorage.setItem('qms:locale:v1', 'en-US');
  const englishView = render(<LanguageProvider>{heading}</LanguageProvider>);
  expect(englishView.getByText(english)).toBeVisible();
});

it.each(['process', 'customer', 'new-product'] as const)('shows a compact, read-only %s header and opens the authorized details on demand', async domain => {
  const fetcher = mount(internal, <ProcessEightDWorkspace problemId={internal.problemId} domain={domain} />);
  const heading = await screen.findByRole('heading', { name: document.title });
  const header = within(heading.closest('header')!);
  expect(header.getByText(internal.reportNumber)).toBeVisible();
  expect(header.getByText('中风险')).toBeVisible();
  expect(header.getByText('办理中')).toBeVisible();
  expect(header.getByRole('button', { name: '流程日志' })).toBeVisible();
  expect(header.queryByRole('button', { name: '保存草稿' })).toBeNull();
  expect(screen.queryByText(internal.currentNodeName!)).toBeNull();
  const requests = fetcher.mock.calls.length;
  const dialog = await showPlans();
  if (domain === 'process') expect(within(dialog).getByText(internal.currentNodeName!)).toBeVisible();
  else expect(within(dialog).queryByText(internal.currentNodeName!)).toBeNull();
  expect(within(dialog).getByText(domain === 'process' ? internal.ownerName! : internal.ownerUserId)).toBeVisible();
  expect(within(dialog).getByText(domain === 'process' ? internal.responsibleSectionName! : internal.responsibleSectionDepartmentId!)).toBeVisible();
  const analysis = within(dialog).getByRole('row', { name: /分析/ });
  expect(within(analysis).getAllByRole('cell').map(cell => cell.textContent)).toEqual([dates.analysisDueAt, dates.analysisCompletedAt]);
  expect(within(dialog).getByText(dates.closureDueAt)).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '责任与计划' })).toBeNull());
  expect(header.getByRole('button', { name: '责任与计划' })).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(requests);
});

it.each([false, true])('uses the same header and plans for supplier workspace (portal=%s)', async portal => {
  mount(supplier, <SupplierEightDWorkspace supplierProblemId={supplier.supplierProblemId} portal={portal} />);
  const header = within((await screen.findByRole('heading', { name: supplier.title, level: 2 })).closest('header')!);
  expect(header.getByText(supplier.reportNumber)).toBeVisible();
  expect(header.getByText('高风险')).toBeVisible();
  expect(header.getByText('审批中')).toBeVisible();
  expect(screen.queryByText(supplier.sqeUserId)).toBeNull();
  const dialog = within(await showPlans());
  expect(dialog.getByText(supplier.sqeUserId)).toBeVisible();
  expect(dialog.getByText(supplier.responsibleSectionDepartmentId)).toBeVisible();
  expect(dialog.queryByText(supplier.sqeAssignmentId)).toBeNull();
  expect(dialog.getByRole('row', { name: /关闭/ })).toHaveTextContent(dates.closureDueAt);
  expect(screen.queryByRole('button', { name: '设置期限' })).toBeNull();
});

it('opens the read-only plans from a D8 stage check when the stage action is unavailable', async () => {
  const message = '请设置正式提交期限';
  mount({ ...internal, submissionDueAt: null, submissionIssues: [{ path: 'submissionDueAt', message }] }, <ProcessEightDWorkspace problemId={internal.problemId} />);
  fireEvent.click(await screen.findByRole('button', { name: /^D8 ·/ }));
  fireEvent.click(screen.getByRole('button', { name: message }));
  const dialog = await screen.findByRole('dialog', { name: '责任与计划' });
  await waitFor(() => expect(within(dialog).getByRole('row', { name: /完整提交/ })).toBeVisible());
  expect(screen.queryByRole('button', { name: '设置期限' })).toBeNull();
});
