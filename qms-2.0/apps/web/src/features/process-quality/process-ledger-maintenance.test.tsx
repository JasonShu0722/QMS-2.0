import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: ({ fileIds }: { fileIds: string[] }) => <span>{fileIds.join(', ')}</span> }));

const organizationId = '22222222-2222-4222-8222-222222222222';
const record = {
  id: '11111111-1111-4111-8111-111111111111', organizationId, description: '第一条不良', version: 2, ledgerStatus: 'CLOSED', sourceKind: 'IMS',
  factoryCode: 'FACTORY_1', responsibilityCategory: 'MATERIAL',
  evidence: [{ id: 'evidence-one' }],
  analysisProgress: '待确认', dispositionPlan: null, dispositionProgress: '已送产线', dispositionCompletedAt: null,
  materials: [
    { id: 'material-one', position: 0, materialCode: 'MAT-1', materialBatch: 'B1', supplierProfileId: 'profile', sqeUserId: 'user', verification: 'NOT_MATERIAL', verificationNotes: '原说明' },
    { id: 'material-two', position: 1, materialCode: 'MAT-2', sqeUserId: 'other', verification: 'UNREVIEWED' },
    { id: 'material-three', position: 2, materialCode: 'MAT-3', sqeUserId: 'user', verification: 'UNREVIEWED' },
  ],
};
const other = { ...record, id: '33333333-3333-4333-8333-333333333333', description: '第二条不良', version: 5, ledgerStatus: 'FOLLOWING', materials: [] };
const capabilities = '/api/v1/process-quality/ledger-workflow-configuration/capabilities';
const maintenance = '/api/v1/process-quality/defects/bulk-maintenance';
const payload = () => JSON.parse(String(vi.mocked(apiRequest).mock.calls.find(([path]) => path === maintenance)?.[1]?.body));

let readCapabilities: () => Promise<unknown>;
let writeMaintenance: () => Promise<unknown>;
let detailRecord: typeof record;
let writeRegistration: (body: Record<string, unknown>) => Promise<unknown>;

beforeEach(() => {
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  readCapabilities = async () => ({ boards: ['ANALYSIS', 'RESPONSIBILITY', 'DISPOSITION', 'CLOSURE', 'MATERIAL_REVIEW'] });
  writeMaintenance = async () => ({ items: [{ ...record, version: 3 }] });
  writeRegistration = async body => {
    if (['analysisProgress', 'responsibilityCategory', 'materials'].some(field => field in body)) {
      throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'Board permission denied' }, 403);
    }
    return { ...detailRecord, ...body, version: 3 };
  };
  detailRecord = record;
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => {
    if (path.startsWith(capabilities)) return readCapabilities();
    if (path === maintenance) return writeMaintenance();
    if (init?.method === 'POST' || init?.method === 'PUT') return writeRegistration(JSON.parse(String(init.body)));
    if (path.includes('/my-permissions')) return { permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close', 'process-quality:materials:review', 'supplier-quality:profiles:read'] };
    if (path.includes('/supplier-quality/profiles')) return { items: [{ id: 'profile', displayName: '联创电子', businessCode: '2000428', supplierOrganizationId: null }], total: 1 };
    if (path.includes('/defects?')) return { items: [record, other], total: 2, page: 1, pageSize: 20 };
    if (path.includes('/material-sqes')) return { items: [], total: 0 };
    if (path.includes(`/defects/${record.id}`) && !path.includes('/issues')) return detailRecord;
    return [];
  });
});

function mount(route = '/app/process-quality') {
  render(<LanguageProvider><MemoryRouter initialEntries={[route]}><UnsavedChangesProvider><ProcessDefectLedgerPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}
async function selectRecords(...records: (typeof record)[]) {
  for (const item of records) fireEvent.click(await screen.findByLabelText(`选择制程不良 ${item.description}`));
  return within(screen.getByLabelText('台账批量操作'));
}
async function openBoard(label: string, scope: ReturnType<typeof within>) {
  fireEvent.click(await scope.findByText(label, { selector: 'button span' }));
  const title = await screen.findByText(label, { selector: '.ant-modal-title' });
  return within(title.closest<HTMLElement>('[role="dialog"]')!);
}
async function save(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByText('保存维护', { selector: 'button span' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(maintenance, expect.objectContaining({ method: 'PATCH' }), expect.anything()));
}

it.each(['POST', 'PUT'] as const)('submits registration-only facts via %s with REGISTRATION as the sole capability', async method => {
  readCapabilities = async () => ({ boards: ['REGISTRATION'] });
  detailRecord = { ...record, sourceKind: 'MANUAL' };
  mount();
  if (method === 'POST') {
    fireEvent.click(await screen.findByText('登记不良', { selector: 'button span' }));
    fireEvent.change(screen.getByLabelText('发生时间', { selector: 'input' }), { target: { value: '2026-11-24T10:20' } });
    fireEvent.change(screen.getByLabelText('成品编码'), { target: { value: 'PRODUCT-1' } });
    fireEvent.change(screen.getByLabelText('追溯码', { selector: 'input' }), { target: { value: 'TRACE-1' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '工厂' }));
    fireEvent.click(await screen.findByText('一工厂', { selector: '.ant-select-item-option-content' }));
  } else {
    fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
    fireEvent.click(await screen.findByText('维护登记信息', { selector: 'button span' }));
  }
  fireEvent.change(screen.getByLabelText('不良描述', { selector: 'textarea' }), { target: { value: '修正登记事实' } });
  fireEvent.click(screen.getByText('保存登记', { selector: 'button span' }));
  const path = method === 'POST' ? '/api/v1/process-quality/defects' : `/api/v1/process-quality/defects/${record.id}`;
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(path, expect.objectContaining({ method }), expect.anything()));
  const body = JSON.parse(String(vi.mocked(apiRequest).mock.calls.find(([url, init]) => url === path && init?.method === method)?.[1]?.body));
  expect(body.description).toBe('修正登记事实');
  for (const field of ['analysisProgress', 'responsibilityCategory', 'materials']) expect(body).not.toHaveProperty(field);
  expect(screen.queryByText('多物料、供应商与SQE')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url.includes('/material-sqes'))).toBe(false);
});

it('shows detail facts in board order and displays supplier name with its code on the material row', async () => {
  mount();
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const title = await screen.findByText('不良品详情', { selector: '.ant-drawer-title' });
  const detail = within(title.closest<HTMLElement>('[role="dialog"]')!);
  const supplier = await detail.findByText('联创电子（2000428）');
  expect(supplier.closest('tr')).toHaveTextContent('原说明');
  const facts = [detail.getByText('登记人'), detail.getByText('分析进展'), detail.getByText('责任类别'), supplier, detail.getByText('处置方案'), detail.getByText('台账状态')];
  for (const [index, fact] of facts.slice(1).entries()) {
    expect(facts[index].compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it('waits for scoped capabilities and excludes unauthorized boards from the batch actions', async () => {
  let resolve!: (value: unknown) => void;
  readCapabilities = () => new Promise(done => { resolve = done; });
  mount(`/app/process-quality?organizationId=${organizationId}`);
  const toolbar = await selectRecords(record, other);
  expect(toolbar.queryByRole('button', { name: '分析进度维护' })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(`${capabilities}?organizationId=${organizationId}`, expect.anything());
  await act(async () => resolve({ boards: ['DISPOSITION'] }));
  expect(toolbar.getByRole('button', { name: '处置维护' })).toBeEnabled();
  expect(toolbar.queryByRole('button', { name: '关闭判定' })).not.toBeInTheDocument();
  expect(toolbar.queryByRole('button', { name: '登记不良' })).not.toBeInTheDocument();
});

it('uses delegated organization capabilities, supplier scope, and registration write scope', async () => {
  const otherOrganizationId = '44444444-4444-4444-8444-444444444444';
  readCapabilities = async () => ({ boards: ['REGISTRATION'] });
  detailRecord = { ...record, organizationId: otherOrganizationId };
  mount(`/app/process-quality?organizationId=${otherOrganizationId}`);
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const detail = within(await screen.findByRole('dialog', { name: '不良品详情' }));
  expect(detail.queryByRole('button', { name: '处置维护' })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(`${capabilities}?organizationId=${otherOrganizationId}`, expect.anything());
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/supplier-quality/profiles?page=1&pageSize=100&organizationId=${otherOrganizationId}`, expect.anything());
  fireEvent.click(await detail.findByText('维护登记信息', { selector: 'button span' }));
  fireEvent.change(screen.getByLabelText('不良描述', { selector: 'textarea' }), { target: { value: '跨组织补充登记' } });
  fireEvent.click(screen.getByText('保存登记', { selector: 'button span' }));
  const path = `/api/v1/process-quality/defects/${record.id}`;
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'PUT' }), expect.anything()));
  const body = JSON.parse(String(vi.mocked(apiRequest).mock.calls.find(([url, init]) => url === path && init?.method === 'PUT')?.[1]?.body));
  expect(body).toEqual({ organizationId: otherOrganizationId, expectedVersion: record.version, description: '跨组织补充登记' });
});

it('updates analysis alone for both closed and open defects with their selected versions', async () => {
  mount();
  const dialog = await openBoard('分析进度维护', await selectRecords(record, other));
  expect(dialog.getByRole('button', { name: '保存维护' })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('分析进度'), { target: { value: '  已完成复测 ' } });
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'ANALYSIS', sources: [record, other].map(({ id, version }) => ({ defectId: id, expectedVersion: version, fields: { analysisProgress: '已完成复测' } })) });
});

it('uses the same disposition endpoint from a closed defect and defaults completion time on demand', async () => {
  detailRecord = { ...record, materials: [] };
  const { evidence: _evidence, ...projection } = detailRecord;
  writeMaintenance = async () => ({ items: [{ ...projection, dispositionPlan: 'SCRAP', version: 3 }] });
  mount();
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const title = await screen.findByText('不良品详情', { selector: '.ant-drawer-title' });
  const detail = within(title.closest<HTMLElement>('[role="dialog"]')!);
  const dialog = await openBoard('处置维护', detail);
  expect(dialog.getByLabelText('处置进度')).toHaveValue('已送产线');
  expect(dialog.getByLabelText('完成时间')).toHaveValue('');
  const now = Date.now();
  fireEvent.click(dialog.getByText('填写完成时间', { selector: 'button span' }));
  const completion = dialog.getByLabelText<HTMLInputElement>('完成时间');
  expect(Math.abs(new Date(completion.value).getTime() - now)).toBeLessThan(60_000);
  fireEvent.change(completion, { target: { value: '2026-11-24T10:20' } });
  fireEvent.click(dialog.getByLabelText('报废', { selector: 'input' }));
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'DISPOSITION', sources: [{ defectId: record.id, expectedVersion: record.version, fields: { dispositionPlan: 'SCRAP', dispositionCompletedAt: new Date('2026-11-24T10:20').toISOString() } }] });
  expect(await detail.findByText('报废')).toBeVisible();
  expect(detail.getByText('evidence-one')).toBeVisible();
});

it('only patches explicitly selected material IDs and adds a line without an ID', async () => {
  mount();
  const dialog = await openBoard('责任判定', await selectRecords(record, other));
  expect(dialog.queryByLabelText('物料批次 1')).not.toBeInTheDocument();
  expect(dialog.queryByLabelText(/^移除物料/)).not.toBeInTheDocument();
  fireEvent.click(dialog.getByLabelText(/MAT-1/, { selector: 'input[type="checkbox"]' }));
  fireEvent.change(dialog.getByLabelText('物料批次 1'), { target: { value: 'B2' } });
  const secondRecord = within(dialog.getByText(other.description, { selector: 'legend' }).closest('fieldset')!);
  fireEvent.click(secondRecord.getByText('新增物料明细', { selector: 'button span' }));
  fireEvent.change(secondRecord.getByLabelText('物料批次 1'), { target: { value: '新批次' } });
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'RESPONSIBILITY', sources: [
    { defectId: record.id, expectedVersion: record.version, fields: { materials: [{ id: 'material-one', materialBatch: 'B2' }] } },
    { defectId: other.id, expectedVersion: other.version, fields: { materials: [{ materialBatch: '新批次' }] } },
  ] });
});

it('marks removal explicitly in single-record responsibility and sends only removed IDs', async () => {
  mount();
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const detail = within(await screen.findByRole('dialog', { name: '不良品详情' }));
  const dialog = await openBoard('责任判定', detail);
  expect(dialog.getByRole('button', { name: '保存维护' })).toBeDisabled();
  fireEvent.click(dialog.getByLabelText('移除物料 MAT-2'));
  expect(dialog.getByLabelText(/MAT-2/, { selector: 'input[name="material-edit"]' })).toBeDisabled();
  fireEvent.click(dialog.getByLabelText('移除物料 MAT-2'));
  expect(dialog.getByRole('button', { name: '保存维护' })).toBeDisabled();
  fireEvent.click(dialog.getByLabelText(/MAT-1/, { selector: 'input[name="material-edit"]' }));
  fireEvent.change(dialog.getByLabelText('物料批次 1'), { target: { value: 'B2' } });
  fireEvent.click(dialog.getByLabelText('移除物料 MAT-1 / B1'));
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'RESPONSIBILITY', sources: [
    { defectId: record.id, expectedVersion: record.version, fields: { removedMaterialIds: ['material-one'] } },
  ] });
});

it('offers only assigned SQE lines and sends only the selected review with changed notes', async () => {
  mount();
  const dialog = await openBoard('物料复核', await selectRecords(record, other));
  expect(dialog.queryByLabelText(/MAT-2/, { selector: 'input[type="checkbox"]' })).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: '保存维护' })).toBeDisabled();
  fireEvent.click(dialog.getByLabelText(/MAT-1/, { selector: 'input[type="checkbox"]' }));
  fireEvent.change(dialog.getByLabelText('复核说明'), { target: { value: '复查一致' } });
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'MATERIAL_REVIEW', sources: [{ defectId: record.id, expectedVersion: record.version, fields: { reviews: [{ materialId: 'material-one', verification: 'NOT_MATERIAL', verificationNotes: '复查一致' }] } }] });
});

it('only reopens defects with a changed status and retains the draft on a version conflict', async () => {
  writeMaintenance = async () => { throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409); };
  mount();
  const dialog = await openBoard('关闭判定', await selectRecords(record, other));
  fireEvent.click(dialog.getByLabelText('恢复跟进', { selector: 'input' }));
  expect(dialog.getByRole('button', { name: '保存维护' })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('恢复原因'), { target: { value: '补充跟进' } });
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'CLOSURE', sources: [{ defectId: record.id, expectedVersion: record.version, fields: { status: 'FOLLOWING', reason: '补充跟进' } }] });
  await dialog.findByText('台账版本已更新。请保留所需输入，关闭后刷新并重新选择台账。');
  expect(dialog.getByLabelText('恢复原因')).toHaveValue('补充跟进');
});
