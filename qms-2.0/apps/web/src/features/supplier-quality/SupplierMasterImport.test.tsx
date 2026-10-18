import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { SupplierMasterImport, parseSupplierMasterRows } from './SupplierMasterImport';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
const spreadsheet = vi.hoisted(() => ({ rows: [] as unknown[][], columns: [{}, {}, {}, {}] as { numFmt?: string; width?: number }[] }));
vi.mock('exceljs', () => ({ default: { Workbook: class {
  xlsx = { writeBuffer: async () => new Uint8Array([1]) };
  addWorksheet() { return { columns: spreadsheet.columns, addRow: (row: unknown[]) => spreadsheet.rows.push(row) }; }
} } }));
beforeEach(() => { spreadsheet.rows = []; vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf'); vi.mocked(readXlsxFile).mockReset().mockResolvedValue([headers, ['0007', '甲'], ['0007', '重复'], [7, '数字编码']]); });

const headers = ['供应商编码', '供应商名称', '联系人', '联系邮箱'];
it('preserves text codes and sends business-invalid rows for per-row server validation', () => {
  expect(parseSupplierMasterRows([headers, ['0007', '甲'], [7, '乙'], ['', '缺编码'], ['x'.repeat(101), '长编码']])).toEqual([
    { rowNumber: 2, businessCode: '0007', displayName: '甲', contactName: undefined, contactEmail: undefined },
    { rowNumber: 3, businessCode: '', displayName: '乙', contactName: undefined, contactEmail: undefined },
    { rowNumber: 4, businessCode: '', displayName: '缺编码', contactName: undefined, contactEmail: undefined },
    { rowNumber: 5, businessCode: 'x'.repeat(101), displayName: '长编码', contactName: undefined, contactEmail: undefined },
  ]);
});
it('rejects unsafe formulas, extra data columns and oversized batches', () => {
  expect(() => parseSupplierMasterRows([headers, ['a', { formula: '1+1' }]])).toThrow();
  expect(() => parseSupplierMasterRows([headers, ['a', 'b', '', '', 'extra']])).toThrow();
  expect(parseSupplierMasterRows([headers, ...Array.from({ length: 101 }, () => ['a', 'b'])])).toHaveLength(101);
});

const upload = () => { if (!screen.queryByLabelText('供应商清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入供应商' })); fireEvent.change(screen.getByLabelText('供应商清单文件'), { target: { files: [new File(['xlsx'], 'suppliers.xlsx')] } }); };
it('downloads a four-column text-only supplier template without organization or account fields', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const create = vi.fn(() => 'blob:template'); const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  try {
    render(<SupplierMasterImport onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '批量导入供应商' }));
    fireEvent.click(screen.getByRole('button', { name: '下载供应商模板' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(spreadsheet.rows).toEqual([headers]);
    expect(spreadsheet.columns.every((column) => column.numFmt === '@')).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:template');
  } finally { click.mockRestore(); vi.unstubAllGlobals(); }
});
it('previews numeric codes as invalid without guessing zeroes and displays mixed server results', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ created: 1, skipped: 1, failed: 1, items: [{ rowNumber: 2, code: '0007', status: 'CREATED' }, { rowNumber: 3, code: '0007', status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, code: '', status: 'FAILED' }] });
  const imported = vi.fn();
  render(<SupplierMasterImport organizationId="owner" onImported={imported} />); upload();
  await screen.findByText('编码需文本；该行将交由服务器校验。');
  fireEvent.click(screen.getByRole('button', { name: '导入供应商' }));
  await screen.findByText('新增 1，重复跳过 1，失败 1');
  expect(screen.getByText('重复跳过')).toBeInTheDocument();
  expect(imported).toHaveBeenCalledOnce();
  const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0]![1]!.body as string);
  expect(body.organizationId).toBe('owner'); expect(body.rows[2].businessCode).toBe(''); expect(body).not.toHaveProperty('supplierOrganizationId');
});

it('prevents double submission and replays a network-unknown batch with the same key', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  vi.mocked(apiRequest).mockReturnValueOnce(pending).mockResolvedValueOnce({ created: 1, skipped: 0, failed: 0, items: [] });
  render(<SupplierMasterImport onImported={vi.fn()} />); upload(); await screen.findByText('数字编码');
  const submit = screen.getByRole('button', { name: '导入供应商' }); fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  await act(async () => { reject(new TypeError('offline')); await pending.catch(() => undefined); });
  await waitFor(() => expect(submit).toBeEnabled()); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(apiRequest).mock.calls[0]![1]!.headers).toEqual(vi.mocked(apiRequest).mock.calls[1]![1]!.headers);
});

it('discards late parsing after switching organization', async () => {
  let resolve!: (value: unknown[][]) => void;
  vi.mocked(readXlsxFile).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = render(<SupplierMasterImport organizationId="a" onImported={vi.fn()} />); upload();
  view.rerender(<SupplierMasterImport organizationId="b" onImported={vi.fn()} />);
  await act(async () => { resolve([headers, ['A', '旧组织供应商']]); });
  expect(screen.queryByText('旧组织供应商')).not.toBeInTheDocument();
  if (!screen.queryByLabelText('供应商清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入供应商' }));
  expect(screen.getByRole('button', { name: '导入供应商' })).toBeDisabled();
});
