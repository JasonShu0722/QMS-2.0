import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessEightDWorkspace } from './ProcessEightDWorkspace';
import type { EightDEvidenceScopeValue } from './EightDEvidenceScope';
import { ApiError } from '../../api/client';

let capturedScope: EightDEvidenceScopeValue | undefined;

vi.mock('./EightDEvidence', async importOriginal => {
  const actual = await importOriginal<typeof import('./EightDEvidence')>();
  const { useContext } = await import('react');
  const { EightDEvidenceScopeContext } = await import('./EightDEvidenceScope');
  const { ApiError } = await import('../../api/client');
  return { ...actual, EightDEvidenceSection: (props: Parameters<typeof actual.EightDEvidenceSection>[0]) => {
    const scope = useContext(EightDEvidenceScopeContext);
    capturedScope = scope;
    return <>
      <button onClick={() => scope?.onPendingChange(props.label, true)}>pending {props.label}</button>
      <button onClick={() => scope?.onPendingChange(props.label, false)}>settled {props.label}</button>
      <button onClick={() => scope?.onAccessDenied(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403))}>denied {props.label}</button>
      <button onClick={() => { props.onChange([...props.fileIds, `${props.label}-clean`]); props.onChange([...props.fileIds, `${props.label}-clean-2`]); }}>ready {props.label}</button>
      <actual.EightDEvidenceSection {...props} />
    </>;
  } };
});

type Report = components['schemas']['ProcessEightDReportDto'];
const report: Report = {
  problemId: 'problem-1', reportNumber: '8D-sensitive', organizationId: 'org-1', instanceId: 'instance-1', workflowVersionId: 'flow-1', instanceVersion: 3, problemVersion: 2,
  version: 7, contentVersion: 4, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner-1', professionalUserId: 'quality-1', responsibleSectionDepartmentId: 'section-1',
  collaboratorUserIds: [], analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null,
  allowedActions: ['read', 'save', 'risk'], sources: [], revisions: [],
  document: { description: 'sensitive body', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:owner-1:org-1');
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/rounds') || url.includes('/requests') ? [] : url.includes('/report?') ? {
    problemId: report.problemId, reportNumber: report.reportNumber, view: 'CURRENT', revisionId: null, label: 'saved report', contentVersion: 4, rowVersion: 7, generatedAt: '', attachments: [],
    snapshot: { document: report.document, sources: [], problem: {}, instance: {}, deadlines: {}, contentVersion: 4, rowVersion: 7, ownerUserId: report.ownerUserId, professionalUserId: report.professionalUserId, responsibleSectionDepartmentId: report.responsibleSectionDepartmentId, collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null },
  } : report), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
});
function mount(onAccessDenied?: (cause: unknown) => void) {
  const router = createMemoryRouter([{ element: <LanguageProvider><UnsavedChangesProvider><Outlet /></UnsavedChangesProvider></LanguageProvider>, children: [
    { path: '/workspace', element: <><Link to="/other">Leave workspace</Link><ProcessEightDWorkspace problemId="problem-1" onAccessDenied={onAccessDenied} /></> },
    { path: '/other', element: <p>Other page</p> },
  ] }], { initialEntries: ['/workspace'] });
  render(<RouterProvider router={router} />);
  return router;
}

it('aggregates panel pending and blocks route leaving until every panel settles', async () => {
  const router = mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: 'pending OK 附件（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: 'pending NG 附件（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: 'settled OK 附件（可选）' }));
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: 'Leave workspace' }));
  expect(router.state.location.pathname).toBe('/workspace');
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'settled NG 附件（可选）' }));
  await screen.findByText('Other page');
});

it('defers inner report switching without unmounting pending evidence', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: 'pending OK 附件（可选）' }));
  fireEvent.click(screen.getByRole('tab', { name: '报告' }));
  expect(screen.getByRole('tab', { name: '工作区' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'settled OK 附件（可选）' })).toBeVisible();
  expect(fetcher.mock.calls.some(([url]) => url.includes('/report?'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'settled OK 附件（可选）' }));
  await screen.findByText('saved report');
});

it('clears pending and sensitive body draft and report on evidence access denial', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.change(screen.getByLabelText('D4 分析过程'), { target: { value: 'sensitive draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'pending OK 附件（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: 'denied OK 附件（可选）' }));
  await screen.findByText(/当前会话失效或无权访问/);
  expect(screen.queryByDisplayValue('sensitive draft')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('sensitive body')).not.toBeInTheDocument();
  expect(screen.queryByText('8D-sensitive')).not.toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Leave workspace' }));
  await screen.findByText('Other page');
  await waitFor(() => expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument());
});

it('does not notify the formal parent from an old scope callback after session replacement', async () => {
  const notify = vi.fn(); mount(notify); await screen.findByDisplayValue('sensitive body');
  const stale = capturedScope!;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-owner:org-1'));
  await screen.findByDisplayValue('sensitive body');
  act(() => stale.onAccessDenied(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'late denial' }, 403)));
  expect(notify).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('sensitive body')).toBeVisible();
  act(() => capturedScope!.onAccessDenied(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'current denial' }, 403)));
  expect(notify).toHaveBeenCalledTimes(1);
  await screen.findByText(/当前会话失效或无权访问/);
});

it('rechecks evidence at the send boundary when pending starts while CSRF is in flight', async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementation((url: string) => url.endsWith('/csrf') ? new Promise<Response>(resolve => { release = resolve; })
    : Promise.resolve(new Response(JSON.stringify(url.includes('/rounds') || url.includes('/requests') ? [] : { ...report, allowedActions: ['read', 'save', 'submit'] }), { headers: { 'content-type': 'application/json' } })));
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: '完整提交' }));
  const confirm = await screen.findByRole('button', { name: '确认提交' });
  fireEvent.submit(confirm.closest('form')!);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => capturedScope!.onPendingChange('late-csrf-panel', true));
  await act(async () => release(new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } })));
  await screen.findByText(/操作未通过/);
  expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/submit') && init?.method === 'POST')).toBe(false);
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  act(() => capturedScope!.onPendingChange('late-csrf-panel', false));
  expect(screen.getByRole('button', { name: '完整提交' })).toBeEnabled();
});

it('closes an unchanged action without waiting on evidence that is readOnly only for that action', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: 'pending OK 附件（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: '调整风险' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'settled OK 附件（可选）' })).toBeVisible();
});

it('retains simultaneous CLEAN receipts across document fields and across fields in one corrective action', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: '增加永久措施' }));
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'ready OK 附件（可选）' }));
    fireEvent.click(screen.getByRole('button', { name: 'ready NG 附件（可选）' }));
    fireEvent.click(screen.getByRole('button', { name: 'ready 措施附件' }));
    fireEvent.click(screen.getByRole('button', { name: 'ready 验证附件' }));
  });
  for (const label of ['OK 附件（可选）', 'NG 附件（可选）', '措施附件', '验证附件']) expect(screen.getByText(`${label} (2)`)).toBeVisible();
});

it('does not remove an evidence-bearing row while any panel is still pending', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(screen.getByRole('button', { name: '增加永久措施' }));
  fireEvent.click(screen.getByRole('button', { name: 'pending 措施附件' }));
  expect(screen.getByRole('button', { name: '移除措施 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'settled 措施附件' }));
  expect(screen.getByRole('button', { name: '移除措施 1' })).toBeEnabled();
});
