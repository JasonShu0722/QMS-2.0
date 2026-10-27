import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { CustomerAnalysisPanel } from './customer-analysis-panel';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => <></>) }));
type Analysis = components['schemas']['CustomerAnalysisDto'];
type Summary = components['schemas']['CustomerAnalysisSummaryDto'];
type Source = components['schemas']['CustomerLedgerDetailDto'];
const base = '/api/v1/customer-quality/analysis';
const session = { userId: 'fae', organizationId: 'selected', accountType: 'INTERNAL' as const, landingPath: '/app/workbench' as const };
const permissions = ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:analyses:fae', 'customer-quality:analyses:supplier'];
const fae: Analysis = { id: 'analysis-fae', complaintId: 'c1', organizationId: 'selected', section: 'FAE', version: 2, assigneeUserId: 'fae', assigneeAssignmentId: 'fae-appointment', departmentId: 'dep', text: '已保存解析', progress: null, result: null, completedOn: null, failedPart: null, failedMaterialCode: null, supplierAnalysisRequired: null, fileIds: [], faeStatus: 'ANALYSED', updatedByUserId: 'fae', updatedAt: '2026-10-26T10:00:00Z' };
let summary: Summary;
const initialSource: Source = {
  id: 'c1', organizationId: 'selected', complaintNumber: 'CQ-1', version: 1, status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null,
  normalized: { complaintType: 'AFTER_SALES', customerName: null, terminalCustomerName: null, componentCode: null, productModel: null, defectDescription: null, quantity: null, vin: null, barcode: null, batch: null, mileage: null, occurredOn: null, productionOn: null, purchaseOn: null, vehicleDeliveryOn: null, vehicleOfflineOn: null, onlineOn: null, occurredAtLocation: null, occurredAtRegion: null, serviceMode: null, interceptionStatus: null, investigation: null },
  raw: {}, warnings: [], registeredByUserId: 'registrar', qualityEngineerId: 'qe', qualityEngineerAssignmentId: 'qe-appointment', qualityEngineerSource: 'MANUAL', stage: 'MASS_PRODUCTION', mapping: null,
  mileageBand: null, serviceMonths: null, misTag: null, courierNumber: null, receivedOn: null, closedAt: null, closedByUserId: null, closureNote: null, createdAt: '2026-10-26T10:00:00Z', history: [],
};
let source: Source;
let handler: (path: string, init?: RequestInit) => unknown;
beforeEach(() => {
  useWorkTabsStore.getState().reset();
  summary = { complaintId: 'c1', fae: { ...fae }, supplier: null };
  source = { ...initialSource, warnings: [] };
  handler = (path, init) => {
    if (init?.method) return { ...(path.endsWith('/supplier') || path.endsWith('/assign/SUPPLIER') ? summary.supplier ?? { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', faeStatus: null } : fae), ...JSON.parse(String(init.body)), version: 3 };
    if (path.startsWith('/api/v1/system/my-permissions')) return { organizationId: 'selected', permissions };
    if (path.startsWith('/api/v1/customer-quality/ledger/c1')) return source;
    if (path.includes('/candidates/')) return [{ userId: 'target', username: '同部门工程师', assignmentId: 'appointment-a', departmentId: 'dep' }, { userId: 'target', username: '同部门工程师', assignmentId: 'appointment-b', departmentId: 'dep' }];
    if (path.includes('/history')) return [{ id: 'history-1', action: 'SAVED', snapshot: fae }];
    if (path.startsWith(`${base}/complaints/c1`)) return summary;
    throw new Error(`Unexpected request ${path}`);
  };
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => handler(path, init) as never);
  vi.mocked(getSession).mockReset().mockResolvedValue(session);
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(AttachmentPanel).mockReset().mockImplementation(({ resource, fileIds, readOnly, onReady, onPendingChange, onRemoved }) => <div aria-label={`attachments-${resource.resourceId}`}>
    <span>{fileIds.join(',')}</span><button disabled={readOnly} onClick={() => onPendingChange?.(true)}>模拟上传待扫描</button>
    <button disabled={readOnly} onClick={() => { onPendingChange?.(false); onReady?.({ id: 'clean-file', ...resource, version: 2, status: 'AVAILABLE', scanStatus: 'CLEAN' } as components['schemas']['FileDto']); }}>模拟实际扫描通过</button>
    <button disabled={readOnly} onClick={() => onRemoved?.('clean-file')}>移除附件关联</button>
  </div>);
});
function mount(onDenied = vi.fn(), sourceRecord?: Source) {
  const content = (record?: Source) => <MemoryRouter initialEntries={['/app/customer-quality?organizationId=selected']}><UnsavedChangesProvider><CustomerAnalysisPanel complaintId="c1" onDenied={onDenied} sourceRecord={record} /><Link to="/other">离开解析</Link></UnsavedChangesProvider></MemoryRouter>;
  const view = render(content(sourceRecord));
  return { ...view, rerenderSource: (record: Source) => view.rerender(content(record)) };
}
const faeSection = () => screen.getByRole('region', { name: 'FAE 解析' });

it('reads the selected organization, uses stable analysis resources, and does not invent a completion date', async () => {
  mount(); await screen.findByLabelText('FAE 解析文字');
  expect(apiRequest).toHaveBeenCalledWith(`${base}/complaints/c1?organizationId=selected`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByLabelText('解析完成日期')).toHaveValue('');
  expect(AttachmentPanel).toHaveBeenCalledWith(expect.objectContaining({ resource: { resourceType: 'customer-complaint-analysis', resourceId: fae.id } }), undefined);
  expect(screen.queryByRole('button', { name: /审批|发问题/ })).not.toBeInTheDocument();
});

it('saves only FAE fields and preserves optional false without defaulting dates', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '实际解析结果' } });
  fireEvent.change(screen.getByLabelText('失效零件'), { target: { value: '阀体' } });
  fireEvent.mouseDown(screen.getByLabelText('是否需要供应商分析'));
  fireEvent.click(await screen.findByText('否'));
  fireEvent.click(within(faeSection()).getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/fae`, expect.objectContaining({ method: 'PUT', body: expect.stringContaining('实际解析结果') }), { replayAfterReauthentication: false }));
  const call = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'PUT')!;
  const body = JSON.parse(String(call[1]?.body));
  expect(body).toMatchObject({ expectedVersion: 2, organizationId: 'selected', text: '实际解析结果', failedPart: '阀体', completedOn: null, supplierAnalysisRequired: false });
  expect(body).not.toHaveProperty('quantity'); expect(body).not.toHaveProperty('approval'); expect(body).not.toHaveProperty('progress');
});

it('blocks save, transfer and refresh while uploads are pending, and attaches only CLEAN receipts', async () => {
  mount(); await screen.findByLabelText('FAE 解析文字');
  fireEvent.click(within(faeSection()).getByRole('button', { name: '模拟上传待扫描' }));
  expect(screen.getByRole('button', { name: '保存 FAE 解析' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '同部门转派 FAE' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新解析' })).toBeDisabled();
  // A pending scan must still be allowed to deliver its clean receipt.
  fireEvent.click(within(faeSection()).getByRole('button', { name: '模拟实际扫描通过' }));
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/fae`, expect.objectContaining({ body: expect.stringContaining('"fileIds":["clean-file"]') }), expect.anything()));
});

it('starts with assignment and no attachment picker when no stable analysis exists', async () => {
  summary.fae = null; vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  mount(); fireEvent.click(await screen.findByRole('button', { name: '指定 FAE' }));
  const dialog = await screen.findByRole('dialog', { name: '指定 FAE' });
  expect(AttachmentPanel).not.toHaveBeenCalled();
  fireEvent.mouseDown(within(dialog).getByRole('combobox'));
  fireEvent.click(await screen.findByText('同部门工程师 · 任职 appointment-b'));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认指定' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/complaints/c1/assign/FAE`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ organizationId: 'selected', expectedVersion: 0, assigneeUserId: 'target', assigneeAssignmentId: 'appointment-b' }) }), expect.anything()));
});

it.each([[true, 'NEW_PRODUCT'], [false, 'MASS_PRODUCTION']] as const)('uses the accepted server dispatch capability %s rather than the current %s mapping', async (canDispatch, stage) => {
  summary.fae = null;
  Object.assign(summary, { canDispatch });
  source = { ...source, stage };
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  mount();
  await screen.findByRole('heading', { name: 'FAE 解析' });
  await waitFor(() => expect(screen.queryByLabelText('正在加载解析')).not.toBeInTheDocument());
  if (canDispatch) expect(screen.getByRole('button', { name: '指定 FAE' })).toBeEnabled();
  else expect(screen.queryByRole('button', { name: '指定 FAE' })).not.toBeInTheDocument();
});

it('recovers stale FAE dispatch explicitly without enabling QE edits or ordinary FAE transfer', async () => {
  Object.assign(summary, { canDispatch: true, canRecoverAssignment: true });
  source = { ...source, stage: 'NEW_PRODUCT' };
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  const original = handler;
  handler = (path, init) => path.startsWith('/api/v1/system/my-permissions')
    ? { organizationId: 'selected', permissions: [...permissions, 'customer-quality:complaints:reassign'] } : original(path, init);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '恢复 FAE 派工' }));
  const dialog = await screen.findByRole('dialog', { name: '恢复 FAE 派工' });
  await waitFor(() => expect(within(dialog).getByRole('combobox')).toBeVisible());
  fireEvent.mouseDown(within(dialog).getByRole('combobox'));
  fireEvent.click(await screen.findByText('同部门工程师 · 任职 appointment-b'));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认恢复派工' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/complaints/c1/assign/FAE`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ organizationId: 'selected', expectedVersion: 2, assigneeUserId: 'target', assigneeAssignmentId: 'appointment-b', recoverStale: true }),
  }), expect.anything()));
  expect(apiRequest).toHaveBeenCalledWith(`${base}/complaints/c1/candidates/FAE?organizationId=selected&recoverStale=true`, expect.anything());
  expect(screen.getByLabelText('FAE 解析文字')).toBeDisabled();
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('已保存解析');
  expect(screen.queryByRole('button', { name: '恢复 FAE 派工' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '同部门转派 FAE' })).not.toBeInTheDocument();
});

it.each([false, true])('requires both explicit recovery permission and the server recovery flag (%s)', async grant => {
  Object.assign(summary, { canDispatch: true, canRecoverAssignment: !grant });
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  const original = handler;
  handler = (path, init) => path.startsWith('/api/v1/system/my-permissions')
    ? { organizationId: 'selected', permissions: grant ? [...permissions, 'customer-quality:complaints:reassign'] : permissions } : original(path, init);
  mount(); await screen.findByLabelText('FAE 解析文字');
  expect(screen.queryByRole('button', { name: '恢复 FAE 派工' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '指定 FAE' })).not.toBeInTheDocument();
});

it('transfers FAE with its current version and the exact chosen assignment identity', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: '同部门转派 FAE' }));
  const dialog = await screen.findByRole('dialog', { name: '同部门转派 FAE' });
  fireEvent.mouseDown(within(dialog).getByRole('combobox'));
  fireEvent.click(await screen.findByText('同部门工程师 · 任职 appointment-a'));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认转派' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/transfer`, expect.objectContaining({ body: JSON.stringify({ organizationId: 'selected', expectedVersion: 2, assigneeUserId: 'target', assigneeAssignmentId: 'appointment-a' }) }), expect.anything()));
});

it('keeps supplier progress/result separate from FAE and hides writes for a non-assignee', async () => {
  summary.supplier = { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', assigneeUserId: 'sqe', progress: '实际进度', result: '实际结果', faeStatus: null };
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'sqe' });
  mount(); fireEvent.change(await screen.findByLabelText('供应商分析进度'), { target: { value: '等待供应商补充试验' } });
  expect(screen.getByLabelText('FAE 解析文字')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存供应商分析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/analysis-sqe/supplier`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ organizationId: 'selected', expectedVersion: 2, progress: '等待供应商补充试验', result: '实际结果', fileIds: [] }) }), expect.anything()));
});

it('preserves the local draft on 409 and requires an explicit discard before refreshing', async () => {
  const original = handler; handler = (path, init) => { if (init?.method) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409); return original(path, init); };
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '冲突草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await screen.findByText('记录已更新，当前输入已保留；请核对后刷新解析。');
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('冲突草稿');
  fireEvent.click(screen.getByRole('button', { name: '刷新解析' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('冲突草稿');
});

it.each([401, 403])('clears both drafts, histories, candidates and attachments on %s', async status => {
  const onDenied = vi.fn(); mount(onDenied);
  fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '私密草稿' } });
  handler = () => { throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status); };
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(onDenied).toHaveBeenCalled());
  expect(screen.queryByLabelText('FAE 解析文字')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(`attachments-${fae.id}`)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('prevents a late mutation after scope changes while CSRF is unresolved', async () => {
  let release!: (token: string) => void;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '旧范围草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
  await act(async () => { useWorkTabsStore.getState().bindSession('INTERNAL:other:other-user'); release('late'); });
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
});

it('protects unsaved text when leaving the panel', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '未保存' } });
  fireEvent.click(screen.getByRole('link', { name: '离开解析' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('未保存');
});

it('loads actual history snapshots instead of fabricating events', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: '查看 FAE 历史' }));
  const dialog = await screen.findByRole('dialog', { name: 'FAE 解析历史' });
  await waitFor(() => expect(within(dialog).getByText('已保存解析')).toBeVisible());
  expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/history?organizationId=selected`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('does not fabricate home-organization authority for a cross-organization viewer', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, organizationId: 'actual-home' });
  mount();
  expect(await screen.findByLabelText('FAE 解析文字')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存 FAE 解析' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '同部门转派 FAE' })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(`${base}/complaints/c1?organizationId=selected`, expect.anything());
});

it('does not mark a new local CLEAN receipt as analysed until the server saves it', async () => {
  summary.fae = { ...fae, text: null, faeStatus: 'NOT_ANALYSED' };
  mount(); await screen.findByLabelText('FAE 解析文字');
  fireEvent.click(within(faeSection()).getByRole('button', { name: '模拟实际扫描通过' }));
  expect(within(faeSection()).getByText('未解析')).toBeVisible();
  expect(within(faeSection()).queryByText('已解析')).not.toBeInTheDocument();
});

it('rejects quarantined and foreign-resource receipts without submitting their ids', async () => {
  vi.mocked(AttachmentPanel).mockImplementation(({ onReady, resource }) => <button onClick={() => {
    onReady?.({ id: 'quarantine', ...resource, version: 1, status: 'QUARANTINED', scanStatus: 'PENDING' } as components['schemas']['FileDto']);
    onReady?.({ id: 'foreign', resourceType: 'customer-complaint-analysis', resourceId: 'different-analysis', version: 2, status: 'AVAILABLE', scanStatus: 'CLEAN' } as components['schemas']['FileDto']);
  }}>不安全回执</button>);
  mount(); fireEvent.click(await screen.findByRole('button', { name: '不安全回执' }));
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/fae`, expect.objectContaining({ body: expect.stringContaining('"fileIds":[]') }), expect.anything()));
});

it('retains saved evidence on missing metadata and blocks save until verified or explicitly unlinked', async () => {
  summary.fae = { ...fae, fileIds: ['existing-evidence'] };
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '新内容' } });
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await screen.findByText('附件尚未完成安全扫描或读取，请刷新附件后保存。');
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  expect(within(faeSection()).getByText('existing-evidence')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '移除附件引用 existing-evidence' }));
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}/${fae.id}/fae`, expect.objectContaining({ body: expect.stringContaining('"fileIds":[]') }), expect.anything()));
});

it('retries an unknown save with its original request and keeps text frozen', async () => {
  const original = handler; let failed = false;
  handler = (path, init) => { if (init?.method && !failed) { failed = true; throw new TypeError('network'); } return original(path, init); };
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '未知结果原稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  const retry = await screen.findByRole('button', { name: '重试确认解析结果' });
  expect(screen.getByLabelText('FAE 解析文字')).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新解析' })).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText('FAE 解析文字')).toBeEnabled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method);
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});

it('clears all content on attachment-access denial, not just the attachment error', async () => {
  const onDenied = vi.fn();
  vi.mocked(AttachmentPanel).mockImplementation(({ onAccessDenied }) => <button onClick={() => onAccessDenied?.(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: '' }, 403))}>撤销附件权限</button>);
  mount(onDenied); fireEvent.click(await screen.findByRole('button', { name: '撤销附件权限' }));
  expect(screen.queryByLabelText('FAE 解析文字')).not.toBeInTheDocument();
  expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
});

it('saves one section without overwriting a sibling unsaved draft', async () => {
  summary.supplier = { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', progress: null, result: null, faeStatus: null };
  mount(); fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: 'FAE 尚未保存' } });
  fireEvent.change(screen.getByLabelText('供应商分析结果'), { target: { value: 'SQE 本次结果' } });
  const save = screen.getByRole('button', { name: '保存供应商分析' });
  fireEvent.click(save);
  await waitFor(() => expect(save).toBeEnabled());
  expect(apiRequest).toHaveBeenCalledWith(`${base}/analysis-sqe/supplier`, expect.objectContaining({ body: expect.stringContaining('SQE 本次结果') }), expect.anything());
  expect(screen.getByLabelText('供应商分析结果')).toHaveValue('SQE 本次结果');
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('FAE 尚未保存');
  expect(within(faeSection()).getByText('当前修改尚未保存')).toBeVisible();
});

it('unmounts open historical snapshots immediately when access is revoked', async () => {
  const original = handler;
  handler = (path, init) => path.includes('/history') ? [{ id: 'private-history', action: 'SAVED', snapshot: { ...fae, text: '仅历史中的机密' } }] : original(path, init);
  mount(); fireEvent.click(await screen.findByRole('button', { name: '查看 FAE 历史' }));
  await screen.findByText('仅历史中的机密');
  const props = vi.mocked(AttachmentPanel).mock.calls.at(-1)![0];
  act(() => props.onAccessDenied?.(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: '' }, 403)));
  await waitFor(() => expect(screen.queryByText('仅历史中的机密')).not.toBeInTheDocument());
  expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
});

it('keeps analyses readable but hides dispatch for a source engineer reported no longer eligible', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  source.warnings = [{ field: 'qualityEngineerAssignmentId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }];
  summary.fae = null;
  summary.supplier = { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', progress: '只读进度', result: '只读结果', faeStatus: null };
  mount(vi.fn(), initialSource);
  expect(await screen.findByLabelText('供应商分析结果')).toHaveValue('只读结果');
  expect(screen.getByLabelText('供应商分析结果')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '指定 FAE' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '指定 SQE' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看供应商分析历史' })).toBeEnabled();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/candidates/'))).toBe(false);
});

it('applies parent close and reopen immediately without remounting or clearing either unsaved draft', async () => {
  summary.supplier = { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', progress: null, result: null, faeStatus: null };
  const { rerenderSource } = mount(vi.fn(), source);
  const text = await screen.findByLabelText('FAE 解析文字');
  fireEvent.change(text, { target: { value: 'FAE 保留草稿' } });
  fireEvent.change(screen.getByLabelText('供应商分析结果'), { target: { value: 'SQE 保留草稿' } });
  const reads = vi.mocked(apiRequest).mock.calls.length;
  rerenderSource({ ...source, version: 2, status: 'CLOSED' });
  expect(text).toBeDisabled();
  expect(screen.getByLabelText('供应商分析结果')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存 FAE 解析' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '同部门转派 FAE' })).not.toBeInTheDocument();
  expect(within(faeSection()).getByRole('button', { name: '模拟上传待扫描' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '查看 FAE 历史' })).toBeEnabled();
  rerenderSource({ ...source, version: 3 });
  expect(screen.getByLabelText('FAE 解析文字')).toBe(text);
  expect(text).toBeEnabled(); expect(text).toHaveValue('FAE 保留草稿');
  expect(screen.getByLabelText('供应商分析结果')).toHaveValue('SQE 保留草稿');
  expect(screen.getByRole('button', { name: '保存供应商分析' })).toBeEnabled();
  expect(vi.mocked(apiRequest).mock.calls).toHaveLength(reads);
});

it('revokes the former source engineer dispatch on parent handoff and keeps readonly analysis content', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  const { rerenderSource } = mount(vi.fn(), source);
  const text = await screen.findByLabelText('FAE 解析文字');
  expect(await screen.findByRole('button', { name: '指定 SQE' })).toBeEnabled();
  rerenderSource({ ...source, version: 2, qualityEngineerId: 'new-qe', qualityEngineerAssignmentId: 'new-appointment' });
  expect(screen.queryByRole('button', { name: '指定 SQE' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('FAE 解析文字')).toBe(text);
  expect(text).toBeDisabled(); expect(text).toHaveValue('已保存解析');
  expect(screen.getByRole('button', { name: '查看 FAE 历史' })).toBeEnabled();
});

it('restores dispatch only for the current source engineer after parent reopen and handoff', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'new-qe' });
  const { rerenderSource } = mount(vi.fn(), source);
  await screen.findByLabelText('FAE 解析文字');
  rerenderSource({ ...source, version: 2, status: 'CLOSED', qualityEngineerId: 'new-qe', qualityEngineerAssignmentId: 'new-appointment' });
  expect(screen.queryByRole('button', { name: '指定 SQE' })).not.toBeInTheDocument();
  rerenderSource({ ...source, version: 3, qualityEngineerId: 'new-qe', qualityEngineerAssignmentId: 'new-appointment' });
  expect(screen.getByRole('button', { name: '指定 SQE' })).toBeEnabled();
  expect(screen.getByLabelText('FAE 解析文字')).toBeDisabled();
});

it('does not replace its newer fetched source with an older parent record', async () => {
  source = { ...source, version: 5, status: 'CLOSED' };
  const { rerenderSource } = mount(vi.fn(), initialSource);
  const text = await screen.findByLabelText('FAE 解析文字');
  rerenderSource({ ...initialSource, version: 4 });
  expect(text).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存 FAE 解析' })).not.toBeInTheDocument();
  rerenderSource({ ...initialSource, version: 6 });
  expect(text).toBeEnabled();
});

it.each([{ id: 'other-complaint' }, { organizationId: 'other-org' }])('ignores a parent source from another scope: %j', async mismatch => {
  const { rerenderSource } = mount(vi.fn(), source);
  const text = await screen.findByLabelText('FAE 解析文字');
  rerenderSource({ ...source, ...mismatch, version: 10, status: 'CLOSED' });
  expect(text).toBeEnabled(); expect(text).toHaveValue('已保存解析');
});

it.each(['close', 'handoff', 'warning'] as const)('checks the actual current source after deferred CSRF before %s dispatch', async change => {
  let release!: (token: string) => void;
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'qe' });
  const onDenied = vi.fn();
  const { rerenderSource } = mount(onDenied, source);
  fireEvent.click(await screen.findByRole('button', { name: '指定 SQE' }));
  const dialog = await screen.findByRole('dialog', { name: '指定 SQE' });
  fireEvent.mouseDown(within(dialog).getByRole('combobox'));
  fireEvent.click(await screen.findByText('同部门工程师 · 任职 appointment-a'));
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认指定' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
  rerenderSource({ ...source, version: 2, ...(change === 'close' ? { status: 'CLOSED' as const } : change === 'handoff' ? { qualityEngineerId: 'new-qe' } : { warnings: [{ field: 'qualityEngineerAssignmentId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }] }) });
  await act(async () => release('late-csrf'));
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('已保存解析');
  expect(onDenied).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: '确认指定' })).toBeDisabled();
});

it('preserves a frozen unknown attempt and its sibling draft across parent close and reopen', async () => {
  summary.supplier = { ...fae, id: 'analysis-sqe', section: 'SUPPLIER', progress: null, result: null, faeStatus: null };
  const original = handler; let failed = false;
  handler = (path, init) => { if (init?.method && !failed) { failed = true; throw new TypeError('network'); } return original(path, init); };
  const { rerenderSource } = mount(vi.fn(), source);
  fireEvent.change(await screen.findByLabelText('FAE 解析文字'), { target: { value: '冻结原稿' } });
  fireEvent.change(screen.getByLabelText('供应商分析结果'), { target: { value: '兄弟分区未保存' } });
  fireEvent.click(screen.getByRole('button', { name: '保存 FAE 解析' }));
  const retry = await screen.findByRole('button', { name: '重试确认解析结果' });
  rerenderSource({ ...source, version: 2, status: 'CLOSED' });
  expect(retry).toBeDisabled(); fireEvent.click(retry);
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue('冻结原稿');
  expect(screen.getByLabelText('供应商分析结果')).toHaveValue('兄弟分区未保存');
  rerenderSource({ ...source, version: 3 });
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText('FAE 解析文字')).toBeEnabled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method);
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(screen.getByLabelText('供应商分析结果')).toHaveValue('兄弟分区未保存');
});

it.each(['save', 'transfer'] as const)('rechecks parent closure after deferred CSRF before %s', async action => {
  let release!: (token: string) => void;
  const onDenied = vi.fn();
  const { rerenderSource } = mount(onDenied, source);
  await screen.findByLabelText('FAE 解析文字');
  let submit: HTMLElement;
  if (action === 'save') {
    fireEvent.change(screen.getByLabelText('FAE 解析文字'), { target: { value: '等待令牌的草稿' } });
    submit = screen.getByRole('button', { name: '保存 FAE 解析' });
  } else {
    fireEvent.click(screen.getByRole('button', { name: '同部门转派 FAE' }));
    const dialog = await screen.findByRole('dialog', { name: '同部门转派 FAE' });
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByText('同部门工程师 · 任职 appointment-a'));
    submit = within(dialog).getByRole('button', { name: '确认转派' });
  }
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(submit);
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
  rerenderSource({ ...source, version: 2, status: 'CLOSED' });
  await act(async () => release('late-csrf'));
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  expect(screen.getByLabelText('FAE 解析文字')).toBeDisabled();
  expect(screen.getByLabelText('FAE 解析文字')).toHaveValue(action === 'save' ? '等待令牌的草稿' : '已保存解析');
  expect(onDenied).not.toHaveBeenCalled();
});

it('does not let a late older source fetch undo a confirmed parent closure', async () => {
  let release!: (record: Source) => void;
  const original = handler;
  handler = (path, init) => path.startsWith('/api/v1/customer-quality/ledger/c1') ? new Promise<Source>(resolve => { release = resolve; }) : original(path, init);
  const { rerenderSource } = mount(vi.fn(), source);
  await waitFor(() => expect(release).toBeDefined());
  rerenderSource({ ...source, version: 2, status: 'CLOSED' });
  await act(async () => release(source));
  expect(await screen.findByLabelText('FAE 解析文字')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存 FAE 解析' })).not.toBeInTheDocument();
});
it('does not let an earlier same-version source response remove a later parent eligibility warning', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: source.qualityEngineerId! });
  let release!: (record: Source) => void;
  const original = handler;
  handler = (path, init) => path.startsWith('/api/v1/customer-quality/ledger/c1') ? new Promise<Source>(resolve => { release = resolve; }) : original(path, init);
  const { rerenderSource } = mount(vi.fn(), source);
  await waitFor(() => expect(release).toBeDefined());
  rerenderSource({ ...source, warnings: [{ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }] });
  await act(async () => release(source));
  await screen.findByLabelText('FAE 解析文字');
  expect(screen.queryByRole('button', { name: '指定 FAE' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '指定 SQE' })).not.toBeInTheDocument();
});
