import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerQualityPage } from './CustomerQualityPage';
import { CustomerLedgerEditor } from './customer-ledger-editor';
import { ledgerBase, type LedgerCandidate, type LedgerDetail } from './customer-ledger-ui';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('./CustomerMasterSection', () => ({ CustomerMasterSection: () => null }));
vi.mock('./customer-analysis-panel', () => ({ CustomerAnalysisPanel: () => null }));
vi.mock('./CustomerLegacyQualityPage', () => ({ CustomerLegacyQualityPage: () => null }));
vi.mock('./customer-ledger-import-panel', () => ({ CustomerLedgerImportPanel: () => null }));
// Keep identity candidates intact; the parent separates assignment options in Detail.
vi.mock('./customer-ledger-detail', () => ({ CustomerLedgerDetail: ({ candidates }: { candidates: LedgerCandidate[] }) => <output aria-label="详情候选投影">{candidates.map(candidate => candidate.assignmentId).join(',')}</output> }));

const org = '22222222-2222-4222-8222-222222222222';
const id = '11111111-1111-4111-8111-111111111111';
const project = { assignmentId: 'project', userId: 'project-user', fullName: '项目质量', username: 'pq', departmentName: null, positionName: null, projectQualified: true };
const cqe = { ...project, assignmentId: 'cqe', userId: 'cqe-user', fullName: 'CQE', projectQualified: false };
const legacy = { assignmentId: 'legacy', userId: 'legacy-user', fullName: '旧候选', username: 'old', departmentName: null, positionName: null };
const broad = [project, cqe, legacy];
const detail: LedgerDetail = {
  id, organizationId: org, complaintNumber: 'CQ-SCOPE', version: 1, status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null,
  raw: { componentCode: 'A' },
  normalized: { complaintType: null, customerName: null, terminalCustomerName: null, componentCode: 'A', productModel: null, defectDescription: null, quantity: null, vin: null, barcode: null, batch: null, mileage: null, occurredOn: null, productionOn: null, purchaseOn: null, vehicleDeliveryOn: null, vehicleOfflineOn: null, onlineOn: null, occurredAtLocation: null, occurredAtRegion: null, serviceMode: null, interceptionStatus: null, investigation: null },
  warnings: [], registeredByUserId: 'user', qualityEngineerId: 'project-user', qualityEngineerAssignmentId: 'project', qualityEngineerSource: 'MANUAL', stage: 'NEW_PRODUCT', mapping: null,
  mileageBand: null, serviceMonths: null, misTag: null, courierNumber: null, receivedOn: null, closedAt: null, closedByUserId: null, closureNote: null, createdAt: '2026-10-27T01:00:00Z', history: [],
};
let currentDetail: LedgerDetail;
const readCandidates = vi.fn<(code: string, signal?: AbortSignal | null) => Promise<components['schemas']['CustomerLedgerCandidatesDto']>>();
const writes = () => vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method);
const reads = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path.includes('/candidates?'));
const select = () => screen.getByRole('combobox', { name: '实际跟进质量工程师' });
const changeCode = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: '组件号' }), { target: { value } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function editor(record?: LedgerDetail, candidates = broad) {
  const props = { record, candidates, organizationId: org, onDenied: vi.fn(), onSaved: vi.fn(), onClose: vi.fn(), refreshDetail: vi.fn().mockResolvedValue(record) };
  return { ...render(<CustomerLedgerEditor {...props} />), props };
}
function page(openDetail = false) {
  return render(<MemoryRouter initialEntries={[`/app/customer-quality?organizationId=${org}${openDetail ? `&complaintId=${id}` : ''}`]}><CustomerQualityPage /></MemoryRouter>);
}
beforeEach(() => {
  currentDetail = detail;
  useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  readCandidates.mockReset().mockResolvedValue({ items: [project] });
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => {
    const url = new URL(path, 'http://localhost');
    if (url.pathname.endsWith('/my-permissions')) return { permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] };
    if (url.pathname.endsWith('/candidates')) return url.searchParams.has('componentCode') ? readCandidates(url.searchParams.get('componentCode')!, init?.signal) : { items: broad };
    if (url.pathname.endsWith('/customers')) return [];
    if (init?.method) return { ...currentDetail, version: 2 };
    if (url.pathname === `${ledgerBase}/${id}`) return currentDetail;
    if (url.pathname === ledgerBase) return { items: [], page: 1, pageSize: 20, total: 0 };
    throw new Error(`Unexpected API: ${path}`);
  });
});

it.each(['NEW_PRODUCT', 'MASS_PRODUCTION'] as const)('preserves all %s identity candidates including the accepted-stage owner and old fixtures', async stage => {
  currentDetail = { ...detail, stage };
  page(true);
  await waitFor(() => expect(screen.getByLabelText('详情候选投影')).toHaveTextContent('project,cqe,legacy'));
  expect(screen.getByLabelText('详情候选投影').textContent).toBe('project,cqe,legacy');
});

it('keeps blank raw code registration and broad candidates without a scoped read', async () => {
  editor();
  expect(within(select()).getByRole('option', { name: 'CQE' })).toBeInTheDocument();
  fireEvent.change(select(), { target: { value: 'cqe' } });
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ qualityEngineerAssignmentId: 'cqe' });
  expect(reads()).toHaveLength(0);
});

it('uses component-scoped candidates, not the broad list, without requesting on the personnel dropdown', async () => {
  editor();
  changeCode(' A & B ');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledWith('A & B', expect.any(AbortSignal)));
  await waitFor(() => expect(within(select()).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument());
  expect(reads()[0][0]).toContain('componentCode=A+%26+B');
  expect(reads()[0][0]).toContain(`organizationId=${org}`);
  expect(select()).toBeEnabled();
  fireEvent.mouseDown(select());
  fireEvent.change(select(), { target: { value: 'project' } });
  expect(readCandidates).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ fields: { componentCode: ' A & B ' }, qualityEngineerAssignmentId: 'project' });
});

it('uses saved-stage candidates until the raw component changes, then accepts MASS scoped CQE', async () => {
  editor(detail, [project, legacy]);
  expect(readCandidates).not.toHaveBeenCalled();
  expect(within(select()).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument();
  readCandidates.mockResolvedValue({ items: [project, cqe] });
  changeCode('B');
  fireEvent.change(select(), { target: { value: 'project' } });
  await waitFor(() => expect(within(select()).getByRole('option', { name: 'CQE' })).toBeInTheDocument());
  fireEvent.change(select(), { target: { value: 'cqe' } });
  fireEvent.click(screen.getByRole('button', { name: '保存台账' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ fields: { componentCode: 'B' }, qualityEngineerAssignmentId: 'cqe' });
});

it('shows the invalid draft warning when scoped replies settle during modal appearance', async () => {
  const a = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  const b = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  readCandidates.mockImplementation(code => code === 'A' ? a.promise : b.promise);
  editor();
  const code = screen.getByLabelText('组件号');
  const engineer = screen.getByLabelText('实际跟进质量工程师');
  fireEvent.change(engineer, { target: { value: 'cqe' } });
  fireEvent.change(code, { target: { value: 'A' } });
  fireEvent.change(code, { target: { value: 'B' } });
  await act(async () => {
    b.resolve({ items: [project] });
    await b.promise;
    a.resolve({ items: [cqe] });
  });
  const warning = screen.getByText('草稿选择不在当前候选人员中，请重新选择或保留映射分配；原草稿未清除。');
  expect(warning.closest('[role="alert"]')).toHaveAttribute('data-show', 'true');
  await waitFor(() => expect(screen.getByText('草稿选择不在当前候选人员中，请重新选择或保留映射分配；原草稿未清除。')).toBeVisible());
  expect(readCandidates).toHaveBeenCalledTimes(2);
  expect(readCandidates.mock.calls[0][1]?.aborted).toBe(true);
  expect(code).toHaveValue('B');
  expect(engineer).toHaveValue('cqe');
  expect(within(engineer).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument();
  expect(within(engineer).getByRole('option', { name: '项目质量' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登记' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  expect(writes()).toHaveLength(0);
});

it('aborts A, keeps the code input usable, and never lets late A overwrite B or send an invalid draft target', async () => {
  const a = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  const b = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  readCandidates.mockImplementation(code => code === 'A' ? a.promise : b.promise);
  editor();
  fireEvent.change(select(), { target: { value: 'cqe' } });
  changeCode('A');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('textbox', { name: '组件号' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '登记' })).toBeDisabled();
  changeCode('B');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(2));
  expect(readCandidates.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => { b.resolve({ items: [project] }); });
  await act(async () => { a.resolve({ items: [cqe] }); });
  expect(screen.getByRole('textbox', { name: '组件号' })).toHaveValue('B');
  expect(select()).toHaveValue('cqe');
  // Scoped replies can settle before the containing Modal finishes its appear motion.
  await waitFor(() => expect(screen.getByText('草稿选择不在当前候选人员中，请重新选择或保留映射分配；原草稿未清除。')).toBeVisible());
  expect(screen.getByRole('button', { name: '登记' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  expect(writes()).toHaveLength(0);
  fireEvent.change(select(), { target: { value: 'project' } });
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ fields: { componentCode: 'B' }, qualityEngineerAssignmentId: 'project' });
});

it('preserves fields and selection on failed reads, blocks dispatch, and explicitly retries without broad fallback', async () => {
  readCandidates.mockRejectedValueOnce(new Error('候选服务不可用')).mockResolvedValue({ items: [project] });
  editor();
  fireEvent.change(select(), { target: { value: 'project' } });
  fireEvent.change(screen.getByLabelText('详细故障描述'), { target: { value: '保留原文' } });
  changeCode('A');
  const retry = await screen.findByRole('button', { name: '重试组件候选人员' });
  await waitFor(() => expect(screen.getByText('候选服务不可用')).toBeVisible());
  expect(select()).toHaveValue('project');
  expect(within(select()).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登记' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  expect(writes()).toHaveLength(0);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: '登记' })).toBeEnabled());
  expect(readCandidates).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('详细故障描述')).toHaveValue('保留原文');
  expect(select()).toHaveValue('project');
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
});

it.each([401, 403])('revokes the parent list and editor on a scoped %s rather than masking it as empty candidates', async status => {
  readCandidates.mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status));
  page(true);
  await screen.findByLabelText('详情候选投影');
  fireEvent.click(screen.getByRole('button', { name: '人工登记客诉' }));
  changeCode('A');
  await screen.findByText(/访问已失效，当前列表、详情和草稿已清除/);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('详情候选投影')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('筛选工程师')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it.each(['unmount', 'session'] as const)('ignores a late scoped read after %s without overwriting the new session/editor', async boundary => {
  const old = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  readCandidates.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [project] });
  const first = editor();
  changeCode('A');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(1));
  if (boundary === 'unmount') first.unmount();
  else act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`); });
  if (boundary === 'unmount') editor();
  changeCode('B');
  await waitFor(() => expect(readCandidates).toHaveBeenLastCalledWith('B', expect.any(AbortSignal)));
  expect(readCandidates.mock.calls[0][1]?.aborted).toBe(true);
  await waitFor(() => expect(within(select()).getByRole('option', { name: '项目质量' })).toBeInTheDocument());
  await act(async () => { old.resolve({ items: [cqe] }); });
  expect(screen.getByRole('textbox', { name: '组件号' })).toHaveValue('B');
  expect(within(select()).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument();
  expect(first.props.onDenied).not.toHaveBeenCalled();
  expect(writes()).toHaveLength(0);
});

it('ignores late denial from the obsolete component and restores broad rules when raw code is cleared', async () => {
  const old = deferred<components['schemas']['CustomerLedgerCandidatesDto']>();
  readCandidates.mockReturnValue(old.promise);
  const { props } = editor();
  changeCode('A');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(1));
  changeCode('');
  await act(async () => { old.reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)); });
  expect(within(select()).getByRole('option', { name: 'CQE' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登记' })).toBeEnabled();
  expect(props.onDenied).not.toHaveBeenCalled();
});

it('keeps the existing NEW stage fallback when a changed component has no mapping', async () => {
  editor(detail);
  changeCode('UNMATCHED');
  await waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(1));
  const path = reads().at(-1)![0];
  expect(new URL(path, 'http://localhost').searchParams.get('stage')).toBe('NEW_PRODUCT');
  await waitFor(() => expect(within(select()).getByRole('option', { name: '项目质量' })).toBeInTheDocument());
  expect(within(select()).queryByRole('option', { name: 'CQE' })).not.toBeInTheDocument();
});

it('retains a long invalid component original without turning candidate lookup into a registration requirement', async () => {
  editor();
  const original = 'X'.repeat(101);
  changeCode(original);
  await waitFor(() => expect(screen.getByRole('button', { name: '登记' })).toBeEnabled());
  expect(readCandidates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body)).fields.componentCode).toBe(original);
});
