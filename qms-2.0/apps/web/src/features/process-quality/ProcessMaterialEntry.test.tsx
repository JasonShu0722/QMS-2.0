import type { components } from '@qms/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { ProcessDefectBoardMaterials, type MaterialDrafts } from './ProcessDefectBoardMaterials';
import { ProcessMaterialEntry } from './ProcessMaterialEntry';
import type { Defect } from './process-ledger';

const scanner = vi.hoisted(() => ({ value: '' }));
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('./ProcessTraceScanner', () => ({ ProcessTraceScanner: ({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) => <button type="button" onClick={() => { onScan(scanner.value); onClose(); }}>读取测试标签</button> }));

type Material = components['schemas']['ProcessDefectMaterialInputDto'];
const original: Material = { materialCode: 'ORIGINAL', materialName: '原物料', supplierProfileId: 'profile-a', supplierOrganizationId: 'supplier-a', materialBatch: 'OLD' };
const suppliers: components['schemas']['SupplierProfileDto'][] = [
  { id: 'profile-a', version: 1, supplierOrganizationId: 'supplier-a', businessCode: '2000428-X', displayName: '同名供应商' },
  { id: 'profile-b', version: 1, supplierOrganizationId: 'supplier-b', businessCode: '2000428', displayName: '同名供应商' },
];
const materialCode = 'D0.800.R1042-03';
const request = vi.mocked(apiRequest);

beforeEach(() => {
  request.mockReset().mockImplementation(async (path) => {
    if (path.startsWith('/api/v1/process-quality/defects/material-sqes?')) return { items: [], total: 0 };
    if (!path.startsWith('/api/v1/material-masters?')) return [];
    const { searchParams } = new URL(path, 'http://localhost');
    const code = searchParams.get('search');
    const page = Number(searchParams.get('page'));
    const item = { id: `master-${page}`, materialCode: page === 1 ? `${code}-OTHER` : code, materialName: page === 1 ? '相似物料' : '匹配物料', version: 1 };
    return { items: [item], total: code === materialCode ? 2 : 1, page, pageSize: 1 };
  });
});

function editor() {
  const onSaved = vi.fn();
  function Harness() {
    const [rows, setRows] = useState<Material[]>([original]);
    return <>{rows.map((row, index) => <section key={index} aria-label={`物料明细 ${index + 1}`}>
      <ProcessMaterialEntry number={index + 1} value={row} organizationId="org" suppliers={suppliers} canReadSuppliers
        onChange={patch => setRows(current => current.map((value, position) => position === index ? { ...value, ...patch } : value))} />
    </section>)}<button type="button" onClick={() => setRows(current => [...current, {}])}>添加物料</button>
    <button type="button" onClick={() => onSaved(rows)}>保存</button></>;
  }
  render(<Harness />);
  return { onSaved, row: within(screen.getByLabelText('物料明细 1')) };
}

it('looks up an exact material code across pages within the record organization', async () => {
  const { row } = editor();
  const input = row.getByLabelText('物料编码 1');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: materialCode } });
  expect(input).toHaveValue(materialCode);
  fireEvent.blur(input);
  await waitFor(() => expect(row.getByLabelText('物料名称 1')).toHaveValue('匹配物料'));
  const queries = request.mock.calls.filter(([path]) => path.startsWith('/api/v1/material-masters?')).map(([path]) => new URL(path, 'http://localhost').searchParams);
  expect(queries.map(query => [query.get('organizationId'), query.get('search'), query.get('page')])).toEqual([['org', materialCode, '1'], ['org', materialCode, '2']]);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'UNKNOWN' } });
  fireEvent.blur(input);
  expect(await row.findByText(/UNKNOWN.*未匹配/)).toBeVisible();
  expect(row.getByLabelText('物料名称 1')).toHaveValue('');
});

it('searches supplier names and distinguishes same-name options using their business codes', async () => {
  const { row, onSaved } = editor();
  const select = row.getByRole('combobox', { name: '供应商名称 1' });
  const user = userEvent.setup();
  await user.type(select, '同名');
  const first = await screen.findByText('同名供应商（2000428-X）', { selector: '.ant-select-item-option-content' });
  await waitFor(() => expect(first).toBeVisible());
  fireEvent.click(screen.getByText('同名供应商（2000428）', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ supplierProfileId: 'profile-b', supplierOrganizationId: 'supplier-b' })]);
});

it('scans into the current row and submits its lookup results and string batch only on save', async () => {
  const { row, onSaved } = editor();
  fireEvent.click(screen.getByText('添加物料'));
  const second = within(screen.getByLabelText('物料明细 2'));
  scanner.value = `Reel&12&2000428&022114&${materialCode}&20221114`;
  fireEvent.click(second.getByRole('button', { name: '扫描批次标签' }));
  fireEvent.click(screen.getByText('读取测试标签'));
  await waitFor(() => expect(second.getByLabelText('物料名称 2')).toHaveValue('匹配物料'));
  expect(second.getByLabelText('物料编码 2')).toHaveValue(materialCode);
  expect(second.getByLabelText('物料批次 2')).toHaveValue('022114');
  expect(second.getByText('同名供应商（2000428）')).toBeVisible();
  expect(row.getByLabelText('物料编码 1')).toHaveValue('ORIGINAL');
  expect(row.getByLabelText('物料批次 1')).toHaveValue('OLD');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onSaved).toHaveBeenCalledWith([original, expect.objectContaining({ materialCode, materialName: '匹配物料', materialBatch: '022114', supplierProfileId: 'profile-b', supplierOrganizationId: 'supplier-b' })]);
});

it('preserves the material row after labels with missing separators or fields', async () => {
  const { row } = editor();
  for (const label of ['Reel&12&2000428&221114', 'Reel&12&&221114&MAT&20221114', 'Reel&12&2000428& &MAT&20221114', 'Reel&12&2000428&221114&&20221114']) {
    scanner.value = label;
    fireEvent.click(row.getByText('扫描批次标签'));
    fireEvent.click(screen.getByText('读取测试标签'));
    expect(await row.findByText(/请重新扫描/)).toBeVisible();
    expect(row.getByLabelText('物料编码 1')).toHaveValue('ORIGINAL');
    expect(row.getByLabelText('物料名称 1')).toHaveValue('原物料');
    expect(row.getByLabelText('物料批次 1')).toHaveValue('OLD');
    expect(row.getByText('同名供应商（2000428-X）')).toBeVisible();
  }
  expect(request.mock.calls.some(([path]) => path.includes('material-masters'))).toBe(false);
});

it('retains the existing row when the scanned supplier is not loaded', async () => {
  const { row } = editor();
  scanner.value = `Reel&12&NOT-LOADED&022114&${materialCode}&2022-11-14`;
  fireEvent.click(row.getByRole('button', { name: '扫描批次标签' }));
  fireEvent.click(screen.getByText('读取测试标签'));
  expect(await row.findByText(/NOT-LOADED.*原值已保留/)).toBeVisible();
  expect(row.getByText('同名供应商（2000428-X）')).toBeVisible();
  expect(row.getByLabelText('物料编码 1')).toHaveValue('ORIGINAL');
  expect(row.getByLabelText('物料批次 1')).toHaveValue('OLD');
  expect(request.mock.calls.some(([path]) => path.includes('material-masters'))).toBe(false);
});

function legacyBoard(direct: boolean) {
  const material = {
    id: 'legacy-material', organizationId: 'org', defectId: 'defect', position: 0,
    materialCode: 'LEGACY', supplierOrganizationId: 'supplier-a', verification: 'UNREVIEWED',
    verificationNotes: null, verifiedById: null, verifiedAt: null, verificationHistory: [],
  } satisfies Defect['materials'][number];
  const record: Defect = {
    id: material.defectId, organizationId: material.organizationId, description: '历史制程不良',
    defectTypeCode: null, defectQuantity: 1, occurredAt: null, lineName: null, operationName: null,
    factoryCode: 'FACTORY_1', shift: null, operationSector: null, productCategory: null,
    productSubcategory: null, projectName: null, projectStage: null, componentProject: null,
    pendingCompletion: false, pendingConfiguration: false, registrationIssues: [], registeredByName: null,
    traceCode: null, analysisProgress: null, dispositionPlan: null, dispositionProgress: null,
    dispositionCompletedAt: null, dispositionHistory: [], ledgerStatus: 'FOLLOWING', closedById: null,
    closedAt: null, responsibilityCategory: 'MATERIAL', sourceKind: 'MANUAL', version: 1,
    materials: [material], materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [],
    duplicateCount: 0, issues: [],
  };
  const onChange = vi.fn<(drafts: MaterialDrafts) => void>();
  const onIncompleteChange = vi.fn<(incomplete: boolean) => void>();
  render(<ProcessDefectBoardMaterials board="RESPONSIBILITY" records={[record]} materialId={direct ? material.id : undefined} organizationId="org"
    suppliers={[]} canReadSuppliers={false} disabled={false} showMaterials onChange={onChange} onIncompleteChange={onIncompleteChange}
    onPendingChange={vi.fn()} onSharedChange={vi.fn()} />);
  return { onChange, onIncompleteChange, materialId: material.id };
}

it.each([true, false])('allows notes and batch edits on legacy material without supplier profile access (direct: %s)', async direct => {
  const { onChange, onIncompleteChange, materialId } = legacyBoard(direct);
  if (!direct) fireEvent.click(screen.getByRole('checkbox', { name: 'LEGACY' }));
  fireEvent.change(screen.getByLabelText('物料说明 1'), { target: { value: '补记现场情况' } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ defect: { materials: [{ id: materialId, notes: '补记现场情况' }] } }));
  expect(onIncompleteChange).toHaveBeenLastCalledWith(false);

  fireEvent.change(screen.getByLabelText('物料批次 1'), { target: { value: 'NEW-LOT' } });
  expect(onChange).toHaveBeenLastCalledWith({ defect: { materials: [{ id: materialId, notes: '补记现场情况', materialBatch: 'NEW-LOT' }] } });
  expect(onIncompleteChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText('物料批次 1'), { target: { value: '' } });
  expect(onIncompleteChange).toHaveBeenLastCalledWith(false);
});

it('requires the supplier profile for a new material even when a code and note are present', () => {
  const { onIncompleteChange } = legacyBoard(false);
  fireEvent.click(screen.getByRole('button', { name: '新增物料明细' }));
  fireEvent.change(screen.getByLabelText('物料编码 2'), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByLabelText('物料说明 2'), { target: { value: '新物料' } });
  expect(onIncompleteChange).toHaveBeenLastCalledWith(true);
});
