import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { eightDPath } from './eight-d';

vi.setConfig({ testTimeout: 30_000 });

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
  capturedScope = undefined;
  vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:owner-1:org-1');
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  vi.stubGlobal('AbortSignal', transferableAbortController().signal.constructor);
  fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/csrf') ? { csrfToken: 'csrf' } : url.includes('/rounds') || url.includes('/requests') ? [] : url.includes('/report?') ? {
    problemId: report.problemId, reportNumber: report.reportNumber, view: url.includes('view=APPROVED') ? 'APPROVED' : 'CURRENT', revisionId: url.includes('view=APPROVED') ? 'approved-revision' : null, label: 'saved report', contentVersion: 4, rowVersion: 7, generatedAt: '', attachments: [], previewFingerprint: 'a'.repeat(64),
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

const actions = () => within(document.querySelector<HTMLElement>('[role="group"][aria-label="办理操作"]')!);
const tabs = () => within(document.querySelector<HTMLElement>('[role="tablist"]')!);
const chapters = () => within(document.querySelector<HTMLElement>('nav[aria-label="8D 内容分区"]')!);
const chapter = (name: string) => within(document.getElementById(`eight-d-${report.problemId}-${name}`)!);
const evidenceControl = (name: string, section = 'D2') => chapter(section).getByText(name, { selector: 'button' });

it('shows each confirmed save briefly', async () => {
  mount();
  await screen.findByDisplayValue('sensitive body');
  const save = actions().getByRole('button', { name: '保存草稿' });
  const confirmation = '服务端已确认保存 / 操作成功。';
  vi.useFakeTimers();
  try {
    for (const iteration of [1, 2]) {
      await act(async () => { fireEvent.click(save); });
      expect(fetcher.mock.calls.filter(([url, init]) => url === eightDPath(report.problemId) && init?.method === 'PUT')).toHaveLength(iteration);
      expect(screen.getByText(confirmation)).toBeVisible();
      act(() => vi.advanceTimersByTime(iteration === 1 ? 2999 : 3000));
      if (iteration === 1) {
        expect(screen.getByText(confirmation)).toBeVisible();
        act(() => vi.advanceTimersByTime(1));
      }
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument();
    }
  } finally {
    vi.useRealTimers();
  }
});

it('does not link a saved row check to a changed draft row', async () => {
  const respond = fetcher.getMockImplementation()!;
  const message = '第 2 条横向展开缺少附件';
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.split('?')[0] !== eightDPath(report.problemId)) return respond(url, init);
    return Response.json({ ...report, submissionIssues: [{ path: 'horizontalDeployment[1].fileIds', message }] });
  });
  mount();
  const description = await screen.findByDisplayValue('sensitive body');
  const directory = chapters();
  fireEvent.click(directory.getByRole('button', { name: 'D8 · 结案总结' }));
  expect(await chapter('D8').findByRole('button', { name: message })).toBeVisible();
  fireEvent.click(directory.getByRole('button', { name: 'D2 · 问题描述' }));
  fireEvent.change(description, { target: { value: 'changed draft' } });
  fireEvent.click(directory.getByRole('button', { name: 'D8 · 结案总结' }));
  expect(await chapter('D8').findByText(message)).toBeVisible();
  expect(chapter('D8').queryByRole('button', { name: message })).not.toBeInTheDocument();
});

it('saves the selected appointment when a team member has several appointments', async () => {
  const respond = fetcher.getMockImplementation()!;
  const appointments = [
    { userId: 'person-1', assignmentId: 'assignment-1', name: '王工', username: 'engineer', department: '制造部', jobTitle: '工程师' },
    { userId: 'person-1', assignmentId: 'assignment-2', name: '王工', username: 'engineer', department: '质量部', jobTitle: '质量主管' },
  ];
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.includes('/team-options?')
    ? Response.json({ items: appointments, total: 2, page: 1, pageSize: 10 })
    : respond(url, init));
  mount();
  await screen.findByDisplayValue('sensitive body');
  fireEvent.click(chapters().getByRole('button', { name: 'D1 · 团队建立' }));
  fireEvent.click(chapter('D1').getByRole('button', { name: '增加团队成员' }));
  const position = await screen.findByText('质量主管');
  const row = position.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /选择.*engineer/ }));
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => {
    const save = fetcher.mock.calls.find(([url, init]) => url === eightDPath(report.problemId) && init?.method === 'PUT');
    expect(JSON.parse(save?.[1]?.body ?? '{}')).toMatchObject({ document: { team: [{ userId: 'person-1', assignmentId: 'assignment-2' }] } });
  });
});

it('previews a structured D2 description while preserving quantities and uncertainty', async () => {
  mount();
  const description = await screen.findByDisplayValue('sensitive body');
  const original = '不良数量：2.5 kg\n• 现象：气密不良\n工序：气密检测\n疑似与治具相关，尚未确认';
  fireEvent.change(description, { target: { value: original } });
  const format = chapter('D2').getByRole('button', { name: '整理为质量工程表述' });
  fireEvent.click(format);
  const preview = await screen.findByRole('dialog', { name: '预览问题描述' });
  await waitFor(() => expect(within(preview).getByText(/工序：气密检测。\s+不良现象：气密不良。\s+已记录不良数量：2\.5 kg。\s+疑似与治具相关，尚未确认。/u)).toBeVisible());
  fireEvent.click(within(preview).getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(preview).not.toBeVisible());
  expect(description).toHaveValue(original);
  fireEvent.click(format);
  const reopened = await screen.findByRole('dialog', { name: '预览问题描述' });
  fireEvent.click(within(reopened).getByRole('button', { name: '使用此描述' }));
  expect(description).toHaveValue('工序：气密检测。\n不良现象：气密不良。\n已记录不良数量：2.5 kg。\n疑似与治具相关，尚未确认。');
});

it('keeps the draft while switching between problem input and the two corrective action chapters', async () => {
  mount();
  const description = await screen.findByDisplayValue('sensitive body');
  fireEvent.change(description, { target: { value: 'unsaved description' } });
  const directory = chapters();
  fireEvent.click(directory.getByRole('button', { name: '问题输入与风险评估' }));
  expect(chapter('input').getByRole('heading', { name: '风险评估' })).toBeVisible();
  expect(description).not.toBeVisible();
  fireEvent.click(directory.getByRole('button', { name: 'D5 · 制定永久纠正措施' }));
  const plans = chapter('D5');
  fireEvent.click(plans.getByRole('button', { name: '增加永久措施' }));
  const countermeasure = plans.getByLabelText('措施 1 对策');
  fireEvent.change(countermeasure, { target: { value: '校验治具' } });
  const verification = directory.getByRole('button', { name: 'D6 · 实施与验证' });
  fireEvent.click(verification);
  const results = chapter('D6');
  expect(results.getByRole('heading', { name: '措施 1 · 校验治具' })).toBeVisible();
  expect(countermeasure).not.toBeVisible();
  fireEvent.click(results.getByRole('button', { name: '详情 措施 1' }));
  fireEvent.change(results.getByLabelText('措施 1 人工有效性结论'), { target: { value: 'false' } });
  fireEvent.click(directory.getByRole('button', { name: 'D2 · 问题描述' }));
  expect(screen.getByDisplayValue('unsaved description')).toBeVisible();
  fireEvent.click(verification);
  expect(results.getByLabelText('措施 1 人工有效性结论')).toHaveValue('false');
});

it('shows the selected report snapshot in both corrective action lists', async () => {
  const respond = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string) => {
    const response = await respond(url);
    if (!url.includes('/report?')) return response;
    const preview = await response.json();
    const approved = url.includes('view=APPROVED');
    const label = approved ? '批准版' : '当前保存版';
    preview.snapshot.document.correctiveActions = ['校验治具', '复查批次'].map((action, index) => ({
      id: `measure-${index}`, causeKind: 'OCCURRENCE', action: `${label}${action}`, owner: label, plannedAt: null,
      verificationMethod: '', fileIds: [], implementationAt: null, result: '', beforeState: `${label}改善前 ${index}`,
      afterState: `${label}改善后 ${index}`, firstBatch: '', followUpBatchCount: null, followUpDuration: '', verificationRecord: '',
      verificationFileIds: ['verification-file'], effective: index === 0,
    }));
    return new Response(JSON.stringify(preview), { headers: { 'content-type': 'application/json' } });
  });
  mount();
  await screen.findByDisplayValue('sensitive body');
  fireEvent.click(tabs().getByRole('tab', { name: '报告' }));
  await screen.findByRole('heading', { name: /^D5 ·/ });
  for (const version of ['CURRENT', 'APPROVED']) {
    const label = version === 'CURRENT' ? '当前保存版' : '批准版';
    if (version === 'APPROVED') {
      fireEvent.change(screen.getByLabelText('报告版本'), { target: { value: version } });
      await screen.findByRole('heading', { name: /^D5 ·/ });
    }
    const plans = within(screen.getByRole('heading', { name: /^D5 ·/ }).closest('section')!);
    expect(plans.getByText(`${label}校验治具`)).toBeVisible();
    expect(plans.getByText(`${label}复查批次`)).toBeVisible();
    const results = within(screen.getByRole('heading', { name: /^D6 ·/ }).closest('section')!);
    expect(results.getByText(`${label}改善前 1`)).toBeVisible();
    expect(results.getByText(`${label}改善后 1`)).toBeVisible();
    expect(results.queryByRole('textbox')).not.toBeInTheDocument();
  }
});

it('aggregates panel pending and blocks route leaving until every panel settles', async () => {
  const router = mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(evidenceControl('pending OK 图片'));
  fireEvent.click(evidenceControl('pending NG 图片'));
  fireEvent.click(evidenceControl('settled OK 图片'));
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: 'Leave workspace' }));
  expect(router.state.location.pathname).toBe('/workspace');
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  fireEvent.click(evidenceControl('settled NG 图片'));
  await screen.findByText('Other page');
});

it('defers inner report switching without unmounting pending evidence', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(evidenceControl('pending OK 图片'));
  fireEvent.click(tabs().getByRole('tab', { name: '报告' }));
  expect(tabs().getByRole('tab', { name: '工作区' })).toHaveAttribute('aria-selected', 'true');
  expect(evidenceControl('settled OK 图片')).toBeVisible();
  expect(fetcher.mock.calls.some(([url]) => url.includes('/report?'))).toBe(false);
  fireEvent.click(evidenceControl('settled OK 图片'));
  await screen.findByText('saved report');
});

it('clears pending and sensitive body draft and report on evidence access denial', async () => {
  mount(); const description = await screen.findByDisplayValue('sensitive body');
  fireEvent.change(description, { target: { value: 'sensitive draft' } });
  expect(description).toHaveValue('sensitive draft');
  fireEvent.click(evidenceControl('pending OK 图片'));
  fireEvent.click(evidenceControl('denied OK 图片'));
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
  const notify = vi.fn(); mount(notify); const oldDescription = await screen.findByDisplayValue('sensitive body');
  const stale = capturedScope!;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-owner:org-1'));
  const newDescription = await screen.findByDisplayValue('sensitive body');
  expect(oldDescription).not.toBeInTheDocument();
  expect(capturedScope).not.toBe(stale);
  act(() => stale.onAccessDenied(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'late denial' }, 403)));
  expect(notify).not.toHaveBeenCalled();
  expect(newDescription).toBeVisible();
  act(() => capturedScope!.onAccessDenied(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'current denial' }, 403)));
  expect(notify).toHaveBeenCalledTimes(1);
  await screen.findByText(/当前会话失效或无权访问/);
});

it('rechecks evidence at the send boundary when pending starts while CSRF is in flight', async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementation((url: string) => url.endsWith('/csrf') ? new Promise<Response>(resolve => { release = resolve; })
    : Promise.resolve(new Response(JSON.stringify(url.includes('/rounds') || url.includes('/requests') ? [] : { ...report, allowedActions: ['read', 'save', 'submit'] }), { headers: { 'content-type': 'application/json' } })));
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(actions().getByRole('button', { name: '完整提交' }));
  const dialog = await screen.findByRole('dialog', { name: /完整提交/ });
  const confirm = within(dialog).getByRole('button', { name: '确认提交' });
  fireEvent.submit(confirm.closest('form')!);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => capturedScope!.onPendingChange('late-csrf-panel', true));
  await act(async () => release(new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } })));
  await within(dialog).findByText(/操作未通过/);
  expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/submit') && init?.method === 'POST')).toBe(false);
  const cancel = within(dialog).getByRole('button', { name: '取消' });
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);
  await waitFor(() => expect(dialog).not.toBeVisible());
  expect(actions().getByRole('button', { name: '保存草稿' })).toBeEnabled();
  act(() => capturedScope!.onPendingChange('late-csrf-panel', false));
  expect(actions().getByRole('button', { name: '完整提交' })).toBeEnabled();
});

it('closes an unchanged action without waiting on evidence that is readOnly only for that action', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(evidenceControl('pending OK 图片'));
  fireEvent.click(actions().getByRole('button', { name: '更多' }));
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: '调整风险' }));
  const dialog = await screen.findByRole('dialog', { name: /调整风险/ });
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(dialog).not.toBeVisible());
  expect(evidenceControl('settled OK 图片')).toBeVisible();
});

it('retains simultaneous CLEAN receipts across image groups and verification evidence', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(chapters().getByRole('button', { name: /^D5 ·/ }));
  fireEvent.click(chapter('D5').getByRole('button', { name: '增加永久措施' }));
  act(() => {
    fireEvent.click(evidenceControl('ready OK 图片'));
    fireEvent.click(evidenceControl('ready NG 图片'));
    fireEvent.click(evidenceControl('ready 验证附件', 'D6'));
  });
  expect(chapter('D6').getByText('验证附件 (2)')).toBeInTheDocument();
  fireEvent.click(chapters().getByRole('button', { name: /^D2 ·/ }));
  expect(chapter('D2').getByRole('region', { name: 'OK 图片' })).toBeVisible();
  expect(chapter('D2').getByRole('region', { name: 'NG 图片' })).toBeVisible();
  fireEvent.click(actions().getByRole('button', { name: '保存草稿' }));
  await waitFor(() => {
    const save = fetcher.mock.calls.find(([url, init]) => url === eightDPath(report.problemId) && init?.method === 'PUT');
    expect(save).toBeDefined();
    const saved = JSON.parse(save![1].body).document as Report['document'];
    expect(saved.okFileIds).toEqual(['OK 图片-clean', 'OK 图片-clean-2']);
    expect(saved.ngFileIds).toEqual(['NG 图片-clean', 'NG 图片-clean-2']);
    expect(saved.correctiveActions[0].verificationFileIds).toEqual(['验证附件-clean', '验证附件-clean-2']);
  });
});

it('does not remove an evidence-bearing row while any panel is still pending', async () => {
  mount(); await screen.findByDisplayValue('sensitive body');
  fireEvent.click(chapters().getByRole('button', { name: /^D5 ·/ }));
  const plans = chapter('D5');
  fireEvent.click(plans.getByRole('button', { name: '增加永久措施' }));
  const remove = plans.getByRole('button', { name: '移除措施 1' });
  act(() => capturedScope!.onPendingChange('verification-panel', true));
  expect(remove).toBeDisabled();
  act(() => capturedScope!.onPendingChange('verification-panel', false));
  expect(remove).toBeEnabled();
});
