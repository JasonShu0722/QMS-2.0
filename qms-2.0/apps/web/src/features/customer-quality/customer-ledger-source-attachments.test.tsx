import type { components } from '@qms/contracts';
import { createHash, webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { CustomerLedgerDetail } from './customer-ledger-detail';
import { CustomerQualityPage } from './CustomerQualityPage';
import { CustomerLedgerSourceAttachments } from './customer-ledger-source-attachments';

const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const path = `/api/v1/customer-quality/ledger/${id}/attachments?organizationId=${org}`;
const file: components['schemas']['FileDto'] = {
  resourceType: 'CustomerComplaint', resourceId: id, id: '33333333-3333-4333-8333-333333333333',
  originalName: '客户清单.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 12,
  sha256: 'a'.repeat(64), version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null,
  uploadExpiresAt: '2026-10-27T12:00:00Z', scannedAt: '2026-10-27T12:00:00Z', deletedAt: null, retainUntil: '2026-11-27T12:00:00Z',
};
const other = { ...file, id: '44444444-4444-4444-8444-444444444444', originalName: '批次清单.xlsx' };
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
function previewFile(contentType: 'image/png' | 'application/pdf'): components['schemas']['FileDto'] {
  const bytes = contentType === 'image/png' ? png : pdf;
  return { ...other, originalName: contentType === 'image/png' ? '来源照片.png' : '客户清单.pdf', contentType, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const session = { user: { accountType: 'INTERNAL', organizationId: org, id: 'qe' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' };
let list: components['schemas']['FileDto'][];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  list = [file, other];
  useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:qe`);
  vi.stubGlobal('crypto', webcrypto);
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url === path) return json(list);
    if (url === `/api/v1/files/${file.id}`) return json(file);
    if (url === `/api/v1/files/${other.id}`) return json(other);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function content(readOnly = false, onDenied = vi.fn(), recordId = id) {
  return <LanguageProvider><CustomerLedgerSourceAttachments recordId={recordId} organizationId={org} readOnly={readOnly} onDenied={onDenied} /></LanguageProvider>;
}

const record: components['schemas']['CustomerLedgerDetailDto'] = {
  id, organizationId: org, complaintNumber: 'CQ-SOURCE-1', version: 1, status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null,
  raw: { complaintType: 'AFTER_SALES', customerName: '清单客户', quantity: '27' },
  normalized: { complaintType: 'AFTER_SALES', customerName: '清单客户', terminalCustomerName: null, componentCode: null, productModel: null, defectDescription: null, quantity: 27, vin: null, barcode: null, batch: null, mileage: null, occurredOn: null, productionOn: null, purchaseOn: null, vehicleDeliveryOn: null, vehicleOfflineOn: null, onlineOn: null, occurredAtLocation: null, occurredAtRegion: null, serviceMode: null, interceptionStatus: null, investigation: null },
  warnings: [], registeredByUserId: 'registrar', qualityEngineerId: 'qe', qualityEngineerAssignmentId: 'assignment', qualityEngineerSource: 'MANUAL', stage: 'MASS_PRODUCTION', mapping: null,
  mileageBand: null, serviceMonths: null, misTag: null, courierNumber: null, receivedOn: null, closedAt: null, closedByUserId: null, closureNote: null, createdAt: '2026-10-27T01:00:00Z', history: [],
};
const people = [{ assignmentId: 'assignment', userId: 'qe', fullName: '实际工程师', username: 'qe', positionName: '项目质量', departmentName: '质量' }];
const permissions = ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:complaints:close', 'customer-quality:complaints:closed-edit'];
function guarded(children: ReactNode) {
  return <ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter><UnsavedChangesProvider>{children}</UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>;
}
function detail(next = record, userId = 'qe', rights = permissions) {
  return guarded(<CustomerLedgerDetail record={next} organizationId={org} candidates={people} userId={userId} permissions={rights} onDenied={vi.fn()} onSaved={vi.fn()} refreshDetail={async () => next} />);
}

it('loads all bound source FileDto IDs through the public ledger list without counting or splitting rows', async () => {
  render(content());
  expect(await screen.findByText(file.originalName)).toBeVisible();
  expect(await screen.findByText(other.originalName)).toBeVisible();
  expect(fetchMock.mock.calls.some(([url]) => url === path)).toBe(true);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toHaveLength(0);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/analysis') || String(url).includes('/complaints/'))).toBe(false);
  expect(screen.getByRole('region', { name: '客诉来源附件' })).toBeVisible();
  expect(screen.getByRole('button', { name: '刷新来源附件' })).toBeEnabled();
});

function uploadNetwork(oldPending = false, metadata = other) {
  let uploaded: components['schemas']['FileDto'] = { ...metadata, status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', version: 1 };
  let bound = false;
  let finish!: (response: Response) => void;
  let uploadSignal: AbortSignal | null | undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (url === path) return json([oldPending ? { ...file, status: 'QUARANTINED', scanStatus: 'PENDING' } : file, ...(bound ? [uploaded] : [])]);
    if (url === '/api/v1/files/uploads') { bound = true; uploadSignal = init?.signal; return json({ file: uploaded, uploadUrl: 'https://objects.example.test/source-upload', headers: {}, urlExpiresAt: other.uploadExpiresAt }); }
    if (url.startsWith('https://')) return new Response(null);
    if (url.endsWith('/complete')) return new Promise(resolve => { finish = resolve; });
    if (url === `/api/v1/files/${uploaded.id}`) return json(uploaded);
    if (url === `/api/v1/files/${file.id}`) return json(oldPending ? { ...file, status: 'QUARANTINED', scanStatus: 'PENDING' } : file);
    if (init?.method) return json({ ...record, version: 2 });
    throw new Error(`Unexpected request: ${url}`);
  });
  return {
    get signal() { return uploadSignal; },
    async complete(clean = false) {
      uploaded = { ...uploaded, version: 2, status: clean ? 'AVAILABLE' : 'QUARANTINED', scanStatus: clean ? 'CLEAN' : 'PENDING' };
      await act(async () => finish(json(uploaded)));
    },
    scanned() { uploaded = { ...uploaded, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' }; },
    ready: () => typeof finish === 'function',
  };
}
async function chooseUpload() {
  const selected = new File(['customer list'], '客户清单.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('customer list').buffer });
  fireEvent.change(await screen.findByLabelText('选择附件'), { target: { files: [selected] } });
}
function beforeUnloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it.each([
  ['FOLLOWING', '关闭台账', '调查结论 / 关闭结果', 'close'],
  ['CLOSED', '恢复跟进', '恢复原因', 'reopen'],
] as const)('blocks %s action while its own real shared upload scans, without counting files', async (status, button, label, endpoint) => {
  const network = uploadNetwork();
  render(detail({ ...record, status }));
  await screen.findByText(file.originalName);
  fireEvent.click(screen.getByLabelText(button));
  fireEvent.change(screen.getByLabelText(label), { target: { value: '实际结论' } });
  await chooseUpload();
  await waitFor(() => expect(network.ready()).toBe(true));
  expect(screen.getByLabelText('保存台账动作')).toBeDisabled();
  expect(beforeUnloadPrevented()).toBe(true);
  expect(fetchMock.mock.calls.some(([url, init]) => url === `${path.split('/attachments')[0]}/${endpoint}` && init?.method === 'POST')).toBe(false);
  await network.complete();
  expect(await screen.findByText('等待安全扫描')).toBeVisible();
  expect(screen.getByLabelText('保存台账动作')).toBeDisabled();
  network.scanned();
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => expect(screen.getByLabelText('保存台账动作')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('保存台账动作'));
  const url = `/api/v1/customer-quality/ledger/${id}/${endpoint}`;
  await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => input === url)).toBe(true));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([input]) => input === url)?.[1]?.body))).toEqual({ organizationId: org, expectedVersion: 1, note: '实际结论' });
  expect(screen.getByText('27', { selector: '.ant-descriptions-item-content' })).toBeVisible();
});

it('blocks edit and reassignment saves but allows cancelling the editor back to the same pending panel', async () => {
  const network = uploadNetwork();
  render(detail());
  await screen.findByText(file.originalName);
  const panel = screen.getByRole('region', { name: '客诉来源附件' });
  fireEvent.click(screen.getByLabelText('编辑台账'));
  const dialog = screen.getByRole('dialog', { name: '编辑台账' });
  fireEvent.change(within(dialog).getByLabelText('实际跟进质量工程师'), { target: { value: '' } });
  fireEvent.change(within(dialog).getByLabelText('详细故障描述'), { target: { value: '保留草稿' } });
  await chooseUpload();
  await waitFor(() => expect(network.ready()).toBe(true));
  expect(within(dialog).getByLabelText('保存台账')).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText('放弃修改并关闭', { selector: 'button span' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑台账' })).not.toBeInTheDocument());
  expect(screen.getByRole('region', { name: '客诉来源附件' })).toBe(panel);
  expect(network.signal?.aborted).toBe(false);
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && init?.method === 'PUT')).toBe(false);
  await network.complete(true);
  await waitFor(() => expect(beforeUnloadPrevented()).toBe(false));
});

it('does not trap read-only viewers or editors on old quarantine, and does not remount a handoff upload', async () => {
  const network = uploadNetwork(true);
  const view = render(detail());
  await screen.findByText('等待安全扫描');
  expect(beforeUnloadPrevented()).toBe(false);
  await chooseUpload();
  await waitFor(() => expect(network.ready()).toBe(true));
  expect(beforeUnloadPrevented()).toBe(true);
  const panel = screen.getByRole('region', { name: '客诉来源附件' });
  view.rerender(detail({ ...record, version: 2, qualityEngineerId: 'new-qe', qualityEngineerAssignmentId: 'new-assignment' }));
  expect(screen.getByRole('region', { name: '客诉来源附件' })).toBe(panel);
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  expect(network.signal?.aborted).toBe(false);
  await network.complete(true);
  await waitFor(() => expect(beforeUnloadPrevented()).toBe(false));
  expect(await screen.findByText(other.originalName)).toBeVisible();
  expect(screen.getAllByRole('button', { name: '下载附件' })).toHaveLength(1);
  const body = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/v1/files/uploads')?.[1]?.body));
  expect(body).toMatchObject({ resourceType: 'CustomerComplaint', resourceId: id });
  expect(body).not.toHaveProperty('quantity');
});

it.each(['close', 'reopen', 'edit'] as const)('uses live source pending after delayed %s CSRF and preserves the existing draft', async action => {
  const network = uploadNetwork();
  const dispatch = fetchMock.getMockImplementation()!;
  let delayCsrf = false;
  let release!: (response: Response) => void;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/csrf') && delayCsrf
    ? new Promise(resolve => { release = resolve; }) : dispatch(input, init));
  render(detail({ ...record, status: action === 'reopen' ? 'CLOSED' : 'FOLLOWING' }));
  await screen.findByText(file.originalName);
  fireEvent.click(screen.getByLabelText(action === 'edit' ? '编辑台账' : action === 'close' ? '关闭台账' : '恢复跟进'));
  const field = action === 'edit' ? '详细故障描述' : action === 'close' ? '调查结论 / 关闭结果' : '恢复原因';
  const save = action === 'edit' ? '保存台账' : '保存台账动作';
  fireEvent.change(screen.getByLabelText(field), { target: { value: '不能丢的实际草稿' } });
  delayCsrf = true;
  fireEvent.click(screen.getByLabelText(save));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  delayCsrf = false;
  await chooseUpload();
  await waitFor(() => expect(network.ready()).toBe(true));
  await act(async () => release(json({ csrfToken: 'late' })));
  await screen.findByText('来源附件正在处理中，请等待后再保存。');
  expect(screen.getByLabelText(field)).toHaveValue('不能丢的实际草稿');
  expect(screen.getByLabelText(save)).toBeDisabled();
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && ['POST', 'PUT'].includes(init?.method ?? ''))).toBe(false);
  await network.complete(true);
  await waitFor(() => expect(screen.getByLabelText(save)).toBeEnabled());
  fireEvent.click(screen.getByLabelText(save));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/ledger/') && ['POST', 'PUT'].includes(init?.method ?? ''))).toHaveLength(1));
});

it('keeps an unknown initialization attempt pending until retry is explicitly abandoned', async () => {
  uploadNetwork();
  const dispatch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/v1/files/uploads') throw new TypeError('lost upload initialization response');
    return dispatch(input, init);
  });
  render(detail());
  await screen.findByText(file.originalName);
  expect(beforeUnloadPrevented()).toBe(false);
  await chooseUpload();
  const abandon = await screen.findByRole('button', { name: '放弃重试' });
  await waitFor(() => expect(abandon).toBeEnabled());
  expect(beforeUnloadPrevented()).toBe(true);
  expect(screen.getAllByRole('button', { name: '下载附件' })).toHaveLength(1);
  fireEvent.click(abandon);
  await waitFor(() => expect(beforeUnloadPrevented()).toBe(false));
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && init?.method)).toBe(false);
});

it('rereads persisted source IDs after unmount rather than treating local upload state as the source list', async () => {
  const view = render(content());
  await screen.findByText(file.originalName);
  view.unmount();
  list = [other];
  render(content());
  expect(await screen.findByText(other.originalName)).toBeVisible();
  expect(screen.queryByText(file.originalName)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(2);
});

it('does not show a loading or failed list as empty and offers a real list retry', async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(async () => json(session));
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(content());
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.getByLabelText('正在读取来源附件')).toBeInTheDocument();
  expect(screen.queryByText('暂无附件')).not.toBeInTheDocument();
  await act(async () => finish(json({ code: 'UNAVAILABLE', message: 'private internals', traceId: 'source-list-failed' }, 503)));
  expect(await screen.findByText('source-list-failed')).toBeVisible();
  expect(screen.queryByText('暂无附件')).not.toBeInTheDocument();
  expect(screen.queryByText('private internals')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取来源附件' }));
  expect(await screen.findByText(file.originalName)).toBeVisible();
});

it.each([401, 403])('forwards list denial %s to the owning page, not an empty list', async status => {
  const denied = vi.fn();
  fetchMock.mockImplementation(async input => String(input) === '/api/v1/auth/session' ? json(session) : json({ code: 'FILE_RESOURCE_DENIED', traceId: 'source-denied' }, status));
  render(content(false, denied));
  await waitFor(() => expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  expect(screen.queryByText('暂无附件')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
});

it('forwards metadata denial through the real shared panel', async () => {
  const denied = vi.fn();
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url === path) return json([file]);
    return json({ code: 'FILE_RESOURCE_DENIED', traceId: 'metadata-denied' }, 403);
  });
  render(content(false, denied));
  await waitFor(() => expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
});

it('preserves read-only access without upload or delete controls for old quarantined source files', async () => {
  const quarantined = { ...file, status: 'QUARANTINED', scanStatus: 'PENDING' };
  fetchMock.mockImplementation(async input => {
    if (String(input) === '/api/v1/auth/session') return json(session);
    return json(String(input) === path ? [quarantined] : quarantined);
  });
  render(content(true));
  expect(await screen.findByText('等待安全扫描')).toBeVisible();
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除附件' })).not.toBeInTheDocument();
});

it('keeps the mounted shared panel across permission handoff without discarding its upload', async () => {
  const view = render(content());
  const picker = await screen.findByLabelText('选择附件');
  view.rerender(content(true));
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  view.rerender(content());
  expect(screen.getByLabelText('选择附件')).not.toBe(picker);
  expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
  expect(await screen.findByText(file.originalName)).toBeVisible();
});

it('aborts an old record list and ignores its late response after switching resource', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url === path) { signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }
    return json([]);
  });
  const view = render(content());
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(content(false, vi.fn(), other.id));
  await screen.findByText('暂无附件');
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(json([file])));
  expect(screen.queryByText(file.originalName)).not.toBeInTheDocument();
});

it('does not deliver a late list or denial into a replacement session scope', async () => {
  let finish!: (response: Response) => void;
  const denied = vi.fn();
  fetchMock.mockImplementation(async input => String(input) === '/api/v1/auth/session' ? json(session) : new Promise(resolve => { finish = resolve; }));
  const view = render(content(false, denied));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:different`));
  view.unmount();
  await act(async () => finish(json({ code: 'FILE_RESOURCE_DENIED' }, 403)));
  expect(denied).not.toHaveBeenCalled();
});

it('mounts two source attachments without changing the canonical quantity or creating rows', async () => {
  render(detail());
  expect(await screen.findByText(file.originalName)).toBeVisible();
  expect(await screen.findByText(other.originalName)).toBeVisible();
  expect(screen.getByText('27', { selector: '.ant-descriptions-item-content' })).toBeVisible();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toHaveLength(0);
});

it.each([
  ['actual QE', record, 'qe', permissions, true],
  ['unassigned registrar', { ...record, qualityEngineerId: null, qualityEngineerAssignmentId: null, qualityEngineerSource: null }, 'registrar', permissions, true],
  ['assigned non-QE registrar', record, 'registrar', permissions, false],
  ['closed without closed-edit', { ...record, status: 'CLOSED' }, 'qe', permissions.filter(right => !right.endsWith('closed-edit')), false],
  ['closed with closed-edit', { ...record, status: 'CLOSED' }, 'qe', permissions, true],
  ['stale QE', { ...record, warnings: [{ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }] }, 'qe', permissions, false],
] as const)('reuses canEdit for %s without adding source maintenance grants', async (_label, next, userId, rights, allowed) => {
  render(detail(next as typeof record, userId, [...rights]));
  await screen.findByText(file.originalName);
  expect(!!screen.queryByLabelText('选择附件')).toBe(allowed);
  expect(screen.queryAllByRole('button', { name: '删除附件' }).length > 0).toBe(allowed);
});

it.each([401, 403])('clears the whole owning ledger page on source list %s', async status => {
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url.includes('/my-permissions')) return json({ organizationId: org, permissions });
    if (url.includes('/candidates')) return json({ items: people });
    if (url.includes('/customers')) return json([]);
    if (url.includes('/attachments')) return json({ code: 'FILE_RESOURCE_DENIED', traceId: 'source-denied' }, status);
    if (url.includes(`/${id}`)) return json(record);
    if (url.includes('/ledger')) return json({ items: [record], total: 1, page: 1, pageSize: 20 });
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter initialEntries={[`/app/customer-quality?complaintId=${id}&organizationId=${org}`]}><UnsavedChangesProvider><CustomerQualityPage renderAnalysis={() => null} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>);
  await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url)).toContain(path));
  await screen.findByText('source-denied');
  expect(screen.queryByRole('region', { name: '客诉详情' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(record.complaintNumber)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
});

it.each(['image/png', 'application/pdf'] as const)('G5 reuses authorized verified %s preview and preserves its modal on a read-only handoff', async contentType => {
  const current = previewFile(contentType);
  const bytes = contentType === 'image/png' ? png : pdf;
  const create = vi.fn(() => 'blob:source-preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'preview-csrf' });
    if (url === path) return json([current]);
    if (url.endsWith('/download')) return json({ url: 'https://objects.example.test/source-preview?signed=original' });
    if (url.startsWith('https://')) return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    return json(current);
  });
  const view = render(content());
  const source = within(screen.getByRole('region', { name: '客诉来源附件' }));
  await source.findByText(current.originalName);
  fireEvent.click(await source.findByLabelText(`预览附件 ${current.originalName}`));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: contentType, size: bytes.length })));
  const dialog = screen.getByRole('dialog', { name: current.originalName });
  const media = contentType === 'image/png' ? within(dialog).getByRole('img', { name: current.originalName }) : within(dialog).getByTitle(current.originalName);
  expect(media).toHaveAttribute('src', 'blob:source-preview');
  await waitFor(() => expect(media).toBeVisible());
  const grants = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/download'));
  expect(grants()).toHaveLength(1);
  expect(grants()[0]?.[1]).toMatchObject({ method: 'POST', body: '{}', headers: { 'x-csrf-token': 'preview-csrf' } });
  expect(fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://'))?.[0]).toBe('https://objects.example.test/source-preview?signed=original');
  view.rerender(content(true));
  expect(screen.getByRole('dialog', { name: current.originalName })).toBe(dialog);
  expect(media).toHaveAttribute('src', 'blob:source-preview');
  expect(revoke).not.toHaveBeenCalled();
  if (contentType === 'image/png') {
    fireEvent.click(within(dialog).getByRole('button', { name: '放大图片' }));
    await waitFor(() => expect(within(dialog).getByText('125%')).toBeVisible());
  } else expect(media).toHaveAttribute('sandbox', '');
  fireEvent.click(within(dialog).getByRole('button', { name: '授权下载附件' }));
  await waitFor(() => expect(grants()).toHaveLength(2));
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && init?.method)).toBe(false);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:source-preview');
});

it.each([401, 403])('G5 forwards preview grant %s to the source owner without displaying bytes', async status => {
  const current = previewFile('image/png');
  const denied = vi.fn();
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'preview-csrf' });
    if (url === path) return json([current]);
    if (url.endsWith('/download')) return json({ code: 'FILE_RESOURCE_DENIED', traceId: 'preview-denied' }, status);
    return json(current);
  });
  render(content(true, denied));
  const source = within(screen.getByRole('region', { name: '客诉来源附件' }));
  await source.findByText(current.originalName);
  fireEvent.click(await source.findByLabelText(`预览附件 ${current.originalName}`));
  await waitFor(() => expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://'))).toBe(false);
});

it('G5 aborts a preview grant waiting for CSRF when its session scope is replaced', async () => {
  const current = previewFile('image/png');
  let release!: (response: Response) => void;
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(session);
    if (url.endsWith('/csrf')) return new Promise(resolve => { release = resolve; });
    if (url === path) return json([current]);
    return json(current);
  });
  const view = render(content(true));
  const source = within(screen.getByRole('region', { name: '客诉来源附件' }));
  await source.findByText(current.originalName);
  fireEvent.click(await source.findByLabelText(`预览附件 ${current.originalName}`));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:different`));
  view.unmount();
  await act(async () => release(json({ csrfToken: 'late' })));
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/download'))).toBe(false);
});

it('G5 rejects a changed server principal after CSRF even before the local scope is rebound', async () => {
  const current = previewFile('image/png');
  let actor = session;
  let release!: (response: Response) => void;
  const denied = vi.fn();
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url === '/api/v1/auth/session') return json(actor);
    if (url.endsWith('/csrf')) return new Promise(resolve => { release = resolve; });
    if (url === path) return json([current]);
    return json(current);
  });
  render(content(true, denied));
  const source = within(screen.getByRole('region', { name: '客诉来源附件' }));
  await source.findByText(current.originalName);
  fireEvent.click(await source.findByLabelText(`预览附件 ${current.originalName}`));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  actor = { ...session, user: { ...session.user, id: 'different' } };
  await act(async () => release(json({ csrfToken: 'late' })));
  await waitFor(() => expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 401 })));
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/download') || String(url).startsWith('https://'))).toBe(false);
});

it('G5 adds only genuinely CLEAN uploaded source IDs to previews and keeps them on resource refresh', async () => {
  const current = previewFile('image/png');
  const network = uploadNetwork(false, current);
  render(detail());
  const source = within(screen.getByRole('region', { name: '客诉来源附件' }));
  const selected = new File([png], current.originalName, { type: current.contentType });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => png.slice().buffer });
  fireEvent.change(await source.findByLabelText('选择附件'), { target: { files: [selected] } });
  await waitFor(() => expect(network.ready()).toBe(true));
  expect(source.queryByLabelText(`预览附件 ${current.originalName}`)).not.toBeInTheDocument();
  await network.complete();
  expect(await source.findByText('等待安全扫描')).toBeVisible();
  expect(source.queryByLabelText(`预览附件 ${current.originalName}`)).not.toBeInTheDocument();
  network.scanned();
  fireEvent.click(source.getByLabelText('刷新附件'));
  expect(await source.findByLabelText(`预览附件 ${current.originalName}`)).toBeEnabled();
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(2));
  fireEvent.click(source.getByLabelText('刷新来源附件'));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(3));
  expect(source.getByLabelText(`预览附件 ${current.originalName}`)).toBeEnabled();
  expect(screen.getByText('27', { selector: '.ant-descriptions-item-content' })).toBeVisible();
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && init?.method)).toBe(false);
});

it('G5 does not acknowledge a CLEAN local receipt bound to a different resource', async () => {
  const network = uploadNetwork(false, { ...other, resourceType: 'process-eight-d', resourceId: '55555555-5555-4555-8555-555555555555' });
  render(detail());
  await chooseUpload();
  await waitFor(() => expect(network.ready()).toBe(true));
  await network.complete(true);
  await waitFor(() => expect(screen.queryByLabelText('正在处理附件')).not.toBeInTheDocument());
  expect(beforeUnloadPrevented()).toBe(true);
  expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/ledger/') && init?.method)).toBe(false);
});
