import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessDefectBoardDialog } from './ProcessDefectBoardDialog';
import { planSharedMaterials, type Supplier } from './ProcessDefectBoardMaterials';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';
import type { Defect } from './process-ledger';

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
  ] satisfies Partial<Defect['materials'][number]>[],
};
const other = { ...record, id: '33333333-3333-4333-8333-333333333333', description: '第二条不良', version: 5, ledgerStatus: 'FOLLOWING', materials: [] };
const legacySupplierOrganizationId = '44444444-4444-4444-8444-444444444444';
const legacy = { ...record, materials: [{ ...record.materials[0], supplierProfileId: undefined, supplierOrganizationId: legacySupplierOrganizationId }] };
const capabilities = '/api/v1/process-quality/ledger-workflow-configuration/capabilities';
const maintenance = '/api/v1/process-quality/defects/bulk-maintenance';
const payload = () => JSON.parse(String(vi.mocked(apiRequest).mock.calls.find(([path]) => path === maintenance)?.[1]?.body));
type LedgerFixture = Omit<typeof record, 'materials'> & { materials: Partial<Defect['materials'][number]>[] };

let readCapabilities: () => Promise<unknown>;
let writeMaintenance: () => Promise<unknown>;
let detailRecord: typeof record;
let readBatchDetail: ((id: string) => Promise<LedgerFixture>) | undefined;
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
  readBatchDetail = undefined;
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => {
    if (path.startsWith(capabilities)) return readCapabilities();
    if (path === maintenance) return writeMaintenance();
    if (init?.method === 'POST' || init?.method === 'PUT') return writeRegistration(JSON.parse(String(init.body)));
    if (path.includes('/my-permissions')) return { permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close', 'process-quality:materials:review', 'supplier-quality:profiles:read'] };
    if (path.includes('/supplier-quality/profiles')) return { items: [{ id: 'profile', displayName: '联创电子', businessCode: '2000428', supplierOrganizationId: null }], total: 1 };
    if (path.includes('/material-masters')) return { items: [], total: 0 };
    if (path.includes('/defects?')) return { items: [record, other], total: 2, page: 1, pageSize: 20 };
    if (path.includes('/material-sqes')) return { items: [], total: 0 };
    if (readBatchDetail && path.includes('/defects/') && init?.method !== 'PATCH') {
      const id = new URL(path, 'http://localhost').pathname.split('/').at(-1)!;
      return readBatchDetail(id);
    }
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
  expect(supplier.closest('tr')).not.toHaveTextContent('原说明');
  expect(detail.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
  expect(detail.getByText('异常物料信息登记')).toBeInTheDocument();
  const facts = [detail.getByText('登记人'), detail.getByText('分析进展'), detail.getByText('责任类别'), supplier, detail.getByText('处置方案'), detail.getByText('台账状态'), detail.getByText('evidence-one'), detail.getByText('已关联问题'), detail.getByText('更新记录')];
  for (const [index, fact] of facts.slice(1).entries()) {
    expect(facts[index].compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it('opens an assigned review by clicking a material row when the user only has the review capability', async () => {
  readCapabilities = async () => ({ boards: ['MATERIAL_REVIEW'] });
  mount();
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const detail = within(await screen.findByRole('dialog', { name: '不良品详情' }));
  expect(detail.queryByRole('button', { name: '编辑异常物料 MAT-2' })).not.toBeInTheDocument();
  fireEvent.click(await detail.findByText('MAT-1', { selector: 'button' }));
  expect(await screen.findByRole('dialog', { name: '物料复核' })).toBeInTheDocument();
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

it('keeps saved detail visible and retries after a transient linked-issues refresh failure', async () => {
  let linkedReads = 0;
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init, signal) => {
    if (path.includes(`/defects/${record.id}/issues`) && ++linkedReads === 2) throw new Error('transient');
    return original(path, init, signal);
  });
  writeMaintenance = async () => {
    detailRecord = { ...record, analysisProgress: '复测完成', version: 3 };
    return { items: [detailRecord] };
  };
  mount();
  fireEvent.click(await screen.findByText(record.description, { selector: '.process-quality-detail-link' }));
  const detail = within(await screen.findByRole('dialog', { name: '不良品详情' }));
  const dialog = await openBoard('分析进度维护', detail);
  fireEvent.change(dialog.getByLabelText('分析进度'), { target: { value: '复测完成' } });
  await save(dialog);
  expect(await detail.findByText('复测完成')).toBeVisible();
  fireEvent.click(await detail.findByRole('button', { name: '重试' }));
  await waitFor(() => expect(linkedReads).toBe(3));
  expect(detail.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
});

async function fillSharedMaterial(dialog: ReturnType<typeof within>, batch: string) {
  fireEvent.click(dialog.getByLabelText('物料', { selector: 'input' }));
  expect(dialog.getAllByLabelText('物料编码 1')).toHaveLength(1);
  const save = dialog.getByText('保存维护', { selector: 'button span' }).closest('button');
  expect(save).toBeDisabled();
  const codeInput = dialog.getByLabelText('物料编码 1');
  fireEvent.focus(codeInput);
  fireEvent.change(codeInput, { target: { value: 'MAT-1' } });
  fireEvent.blur(codeInput);
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('/material-masters?'), expect.anything());
  const materialName = dialog.getByLabelText('物料名称 1');
  await waitFor(() => expect(materialName).toHaveAttribute('placeholder', '未匹配'));
  expect(save).toBeDisabled();
  fireEvent.mouseDown(dialog.getByLabelText('供应商名称 1'));
  fireEvent.click(await screen.findByText('联创电子（2000428）', { selector: '.ant-select-item-option-content' }));
  fireEvent.change(dialog.getByLabelText('物料批次 1'), { target: { value: batch } });
}

function mountSharedMaterialDialog(records: LedgerFixture[], supplierOrganizationId: string | null = null) {
  readBatchDetail ??= async id => records.find(item => item.id === id)!;
  render(<ProcessDefectBoardDialog board="RESPONSIBILITY" records={records as unknown as Defect[]} organizationId={organizationId} userId="user"
    suppliers={[{ id: 'profile', displayName: '联创电子', businessCode: '2000428', supplierOrganizationId, version: 1 }]} canReadSuppliers
    onClose={vi.fn()} onSaved={vi.fn()} onDenied={vi.fn()} />);
  return within(screen.getByText('责任判定', { selector: '.ant-modal-title' }).closest<HTMLElement>('[role="dialog"]')!);
}

it('uses one material form, preserves a matching line and creates an independent line for the other ledger', async () => {
  const dialog = mountSharedMaterialDialog([record, other]);
  expect(dialog.queryByLabelText('物料编码 1')).not.toBeInTheDocument();
  await fillSharedMaterial(dialog, 'B1');
  await save(dialog);
  expect(payload()).toEqual({ organizationId, board: 'RESPONSIBILITY', sources: [
    { defectId: record.id, expectedVersion: record.version, compareOnly: true, fields: {} },
    { defectId: other.id, expectedVersion: other.version, fields: { materials: [{ materialCode: 'MAT-1', materialBatch: 'B1', supplierProfileId: 'profile' }] } },
  ] });
});

it('preserves an identical verified legacy material when the selected supplier profile maps to its organization', async () => {
  const dialog = mountSharedMaterialDialog([legacy, other], legacySupplierOrganizationId);
  await fillSharedMaterial(dialog, 'B1');
  await save(dialog);
  expect(dialog.queryByLabelText('物料冲突确认')).not.toBeInTheDocument();
  expect(payload().sources).toEqual([
    { defectId: legacy.id, expectedVersion: legacy.version, compareOnly: true, fields: {} },
    { defectId: other.id, expectedVersion: other.version, fields: { materials: [{ materialCode: 'MAT-1', materialBatch: 'B1', supplierProfileId: 'profile', supplierOrganizationId: legacySupplierOrganizationId }] } },
  ]);
});

it.each([true, false])('keeps a supplier conflict when the legacy mapping is visible: %s', mapped => {
  const suppliers: Supplier[] = [{ id: 'other-profile', displayName: '新供应商', businessCode: '2000429', supplierOrganizationId: null, version: 1 }];
  if (mapped) suppliers.push({ id: 'profile', displayName: '联创电子', businessCode: '2000428', supplierOrganizationId: legacySupplierOrganizationId, version: 1 });
  const { conflicts } = planSharedMaterials([legacy as unknown as Defect], {
    values: { materialCode: 'MAT-1', materialBatch: 'B1', supplierProfileId: mapped ? 'other-profile' : 'profile' }, sqes: [],
  }, suppliers);
  expect(conflicts[0]?.candidates[0]?.differences).toEqual([{
    field: 'supplierProfileId', label: '供应商名称', before: mapped ? '联创电子（2000428）' : '供应商名称不可用', after: mapped ? '新供应商（2000429）' : '档案 profile',
  }]);
});

it.each(['覆盖', '跳过本条'] as const)('reviews the precise conflict before batch responsibility and applies %s', async decision => {
  const existing = { ...record, responsibilityCategory: 'OPERATION' };
  const matching = { ...other, id: '55555555-5555-4555-8555-555555555555', description: '已有相同物料', version: 9, materials: [{ ...record.materials[0], materialBatch: 'B2' }] };
  const dialog = mountSharedMaterialDialog([existing, other, matching]);
  await fillSharedMaterial(dialog, 'B2');
  const button = (label: string) => dialog.getByText(label, { selector: 'button span' }).closest('button')!;
  fireEvent.click(button('保存维护'));
  const conflict = within(await dialog.findByLabelText('物料冲突确认'));
  expect(conflict.getByText('第一条不良', { selector: 'legend' })).toBeVisible();
  expect(conflict.getByText('物料批次', { selector: 'td' })).toBeVisible();
  expect(conflict.getByText('B1', { selector: 'td' })).toBeVisible();
  expect(conflict.getByText('B2', { selector: 'td' })).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === maintenance)).toBe(false);
  fireEvent.click(button('返回修改'));
  expect(dialog.getByLabelText('物料批次 1')).toHaveValue('B2');
  expect(dialog.getByText('已选择 3 条台账')).toBeVisible();
  fireEvent.click(button('保存维护'));
  expect((await dialog.findByText('确认保存', { selector: 'button span' })).closest('button')).toBeDisabled();
  fireEvent.click(dialog.getByLabelText(decision, { selector: 'input' }));
  fireEvent.click(button('确认保存'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(maintenance, expect.objectContaining({ method: 'PATCH' }), expect.anything()));
  expect(payload()).toEqual({ organizationId, board: 'RESPONSIBILITY', sources: [
    ...(decision === '覆盖' ? [{ defectId: record.id, expectedVersion: record.version, fields: { responsibilityCategory: 'MATERIAL', materials: [{ id: 'material-one', materialBatch: 'B2' }] } }] : []),
    { defectId: other.id, expectedVersion: other.version, fields: { materials: [{ materialCode: 'MAT-1', materialBatch: 'B2', supplierProfileId: 'profile' }] } },
    { defectId: matching.id, expectedVersion: matching.version, compareOnly: true, fields: {} },
  ] });
});

it('reads scoped versions before checking a batch conflict and only overwrites the freshly shown values', async () => {
  const fresh = { ...record, version: 6, materials: record.materials.map(item => item.supplierProfileId ? { ...item, materialBatch: '已变更批次' } : item) };
  readBatchDetail = async id => id === record.id ? fresh : other;
  const dialog = mountSharedMaterialDialog([record, other]);
  await fillSharedMaterial(dialog, 'B1');
  fireEvent.click(dialog.getByText('保存维护', { selector: 'button span' }));
  const conflict = within(await dialog.findByLabelText('物料冲突确认'));
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${record.id}?organizationId=${organizationId}`, expect.anything());
  expect(conflict.getByText('已变更批次')).toBeVisible();
  expect(conflict.getByText('B1')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === maintenance)).toBe(false);
  fireEvent.click(conflict.getByLabelText('覆盖', { selector: 'input' }));
  fireEvent.click(dialog.getByText('确认保存', { selector: 'button span' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(maintenance, expect.objectContaining({ method: 'PATCH' }), expect.anything()));
  expect(payload().sources[0]).toEqual({ defectId: record.id, expectedVersion: 6, fields: { materials: [{ id: 'material-one', materialBatch: 'B1' }] } });
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
