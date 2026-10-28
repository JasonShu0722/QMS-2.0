import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierQualityPage } from './SupplierQualityPage';

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const base = '/api/v1/supplier-quality/eight-d';
const report: components['schemas']['SupplierEightDReportDto'] = {
  supplierProblemId: id, problemId: 'index-id', organizationId: 'org', instanceId: 'instance', workflowVersionId: 'flow',
  title: '受控整改机密标题', reportNumber: 'SQ-DIRECT', severity: 'HIGH', status: 'PROCESSING', rowVersion: 4, contentVersion: 6, instanceVersion: 2,
  sqeUserId: 'sqe', sqeAssignmentId: 'assignment', responsibleSectionDepartmentId: 'section',
  submittedRevisionId: null, approvedRevisionId: null, analysisDueAt: null, analysisCompletedAt: null, submissionDueAt: null,
  submittedAt: null, closureDueAt: null, closedAt: null, releasedToSupplierAt: null, closure: null, allowedActions: ['read', 'save'],
  document: { description: '受控整改机密正文', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
    analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init: RequestInit };
function api(intercept?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = { path: String(input), init }; requests.push(request);
    const response = intercept?.(request);
    if (response) return Promise.resolve(response);
    if (request.path === '/api/v1/auth/csrf') return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (request.path === '/api/v1/auth/session') return Promise.resolve(json({ user: { accountType: 'INTERNAL', organizationId: 'org', id: 'sqe' }, securityState: 'AUTHENTICATED', landingPath: '/app/workbench' }));
    if (request.path.startsWith(`${base}/`)) return Promise.resolve(json(report));
    // Legacy reads are deliberately unauthorized, not a prerequisite for the controlled report.
    return Promise.resolve(json({ code: 'FEATURE_PERMISSION_DENIED', message: 'legacy read denied' }, 403));
  }));
  return requests;
}
function Controls() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/app/supplier-quality/eight-d/${secondId}`)}>切换受控问题</button>;
}
function mount(path = `/app/supplier-quality/eight-d/${id}`, portal = false) {
  return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><UnsavedChangesProvider><Controls /><Routes>
    <Route path={portal ? '/supplier/corrections/*' : '/app/supplier-quality/*'} element={<SupplierQualityPage portal={portal} />} />
  </Routes></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
}
beforeEach(() => { useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:sqe'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); sessionStorage.clear(); });

it('opens and saves the real controlled workspace without legacy problem or generic index reads', async () => {
  const requests = api(); mount();
  expect(await screen.findByDisplayValue('受控整改机密正文')).toBeVisible();
  fireEvent.change(screen.getByLabelText('D2 问题描述'), { target: { value: '本次受控修改' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(requests.some(({ init }) => init.method === 'PUT')).toBe(true));
  const write = requests.find(({ init }) => init.method === 'PUT')!;
  expect(write.path).toBe(`${base}/${id}`);
  expect(JSON.parse(String(write.init.body))).toMatchObject({ expectedRowVersion: 4, expectedInstanceVersion: 2, document: { description: '本次受控修改' } });
  expect(requests.every(({ path }) => path === `${base}/${id}` || path.startsWith('/api/v1/auth/'))).toBe(true);
});

it.each([401, 403])('clears the real workspace on a controlled refresh %s without falling back to legacy reads', async status => {
  let denied = false;
  const requests = api(({ path }) => denied && path === `${base}/${id}` ? json({ code: 'FEATURE_PERMISSION_DENIED' }, status) : undefined);
  mount(); await screen.findByDisplayValue('受控整改机密正文');
  denied = true; fireEvent.click(screen.getByRole('button', { name: '刷新工作区' }));
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除。')).toBeVisible();
  expect(screen.queryByText('受控整改机密标题')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('受控整改机密正文')).not.toBeInTheDocument();
  expect(requests.every(({ path }) => path === `${base}/${id}`)).toBe(true);
});

it.each(['not-a-uuid', '------------------------------------', `${id}/extra`, ''])('rejects invalid direct-route UUID %s without any API request or ledger fallback', async invalid => {
  const requests = api(); mount(`/app/supplier-quality/eight-d/${invalid}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('无效的供应商8D问题标识');
  expect(requests).toHaveLength(0);
  expect(screen.queryByText('新增供应商问题')).not.toBeInTheDocument();
});

it('aborts the previous id and rejects its late response after real router navigation', async () => {
  let resolve!: (value: Response) => void;
  const requests = api(({ path }) => path === `${base}/${id}` ? new Promise<Response>(done => { resolve = done; })
    : path === `${base}/${secondId}` ? json({ ...report, supplierProblemId: secondId, title: '新问题标题', document: { ...report.document, description: '新问题正文' } }) : undefined);
  mount(); fireEvent.click(screen.getByRole('button', { name: '切换受控问题' }));
  expect(await screen.findByDisplayValue('新问题正文')).toBeVisible();
  expect(requests.find(({ path }) => path === `${base}/${id}`)?.init.signal?.aborted).toBe(true);
  await act(async () => resolve(json(report)));
  expect(screen.queryByText('受控整改机密标题')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('新问题正文')).toBeVisible();
});

it('clears the previous principal immediately and ignores its late controlled report', async () => {
  let resolve!: (value: Response) => void;
  let calls = 0;
  const requests = api(({ path }) => path === `${base}/${id}` && ++calls === 1 ? new Promise<Response>(done => { resolve = done; })
    : path === `${base}/${id}` ? json({ ...report, title: '新会话标题', document: { ...report.document, description: '新会话正文' } }) : undefined);
  mount(); act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:other'));
  expect(await screen.findByDisplayValue('新会话正文')).toBeVisible();
  expect(requests[0].init.signal?.aborted).toBe(true);
  await act(async () => resolve(json(report)));
  expect(screen.queryByText('受控整改机密标题')).not.toBeInTheDocument();
});

it('keeps the legacy internal problem route on its original read and does not bypass its denial', async () => {
  const requests = api(); mount(`/app/supplier-quality/problems/${id}`);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(requests.some(({ path }) => path.startsWith(`/api/v1/supplier-quality/problems/${id}?`))).toBe(true);
  expect(requests.some(({ path }) => path.startsWith(base))).toBe(false);
});

it('keeps the portal problem route reading its legacy parent before mounting its real controlled workspace', async () => {
  useWorkTabsStore.getState().bindSession('SUPPLIER:vendor:user');
  const requests = api(({ path }) => path.startsWith(`/api/v1/supplier-portal/problems/${id}?`) ? json({
    id, version: 1, title: '门户原问题', supplierName: '供应商', materialCode: 'PART', defectDescription: '原事实', defectQuantity: 1,
    severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', stage: 'ISSUED', canEditFacts: false, canEditResponse: false,
    controlledEightD: true, responseDraft: {}, updatedAt: '2026-10-28T00:00:00Z',
  }) : path === `/api/v1/supplier-portal/eight-d/${id}` ? json({ ...report, allowedActions: ['read'] }) : undefined);
  mount(`/supplier/corrections/problems/${id}`, true);
  expect(await screen.findByDisplayValue('受控整改机密正文')).toBeDisabled();
  expect(screen.getByText('门户原问题')).toBeVisible();
  expect(requests[0].path).toMatch(`/api/v1/supplier-portal/problems/${id}?`);
  expect(requests.some(({ path }) => path.startsWith('/api/v1/supplier-quality'))).toBe(false);
});
