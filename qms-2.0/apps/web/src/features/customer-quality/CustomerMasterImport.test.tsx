import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { CustomerMasterImport, parseCustomerMasterRows } from './CustomerMasterImport';
import { LanguageProvider } from '../../i18n/Language';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => {
  localStorage.removeItem('qms:locale:v1');
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(readXlsxFile).mockReset().mockResolvedValue([['客户编码', '客户名称'], ['00042', '中文客户'], ['00042', '不同名称']]);
});
afterEach(() => localStorage.removeItem('qms:locale:v1'));
const upload = () => { if (!screen.queryByLabelText('客户清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入客户' })); fireEvent.change(screen.getByLabelText('客户清单文件'), { target: { files: [new File(['xlsx'], 'customers.xlsx')] } }); };

it('maps only code/name, preserves leading zeroes and spreadsheet row numbers', () => {
  expect(parseCustomerMasterRows([['客户名称', '客户编码'], [' 中文客户 ', '00042'], [], ['二客户', 'abc']])).toEqual([
    { rowNumber: 2, code: '00042', name: '中文客户' }, { rowNumber: 4, code: 'abc', name: '二客户' },
  ]);
  for (const sheet of [[], [['客户编码', '关系']], [['客户编码', '客户名称'], [{ formula: '1+1', result: 2 }, '客户']], [['客户编码', '客户名称'], ['code', 'name', '额外']]]) expect(() => parseCustomerMasterRows(sheet)).toThrow();
  expect(parseCustomerMasterRows([['客户编码', '客户名称'], ...Array.from({ length: 101 }, () => ['code', 'name'])])).toHaveLength(101);
});

it('keeps invalid business rows for server validation, including an invalid code before a valid same-code row', () => {
  expect(parseCustomerMasterRows([['客户编码', '客户名称'], ['GOOD', '合法'], ['BAD', ''], ['BAD', '后续合法'], [42, '数字编码'], ['', '空编码'], ['x'.repeat(101), '长编码'], ['LONG-NAME', '名'.repeat(201)]])).toEqual([
    { rowNumber: 2, code: 'GOOD', name: '合法' }, { rowNumber: 3, code: 'BAD', name: '' }, { rowNumber: 4, code: 'BAD', name: '后续合法' }, { rowNumber: 5, code: '', name: '数字编码' }, { rowNumber: 6, code: '', name: '空编码' }, { rowNumber: 7, code: 'x'.repeat(101), name: '长编码' }, { rowNumber: 8, code: 'LONG-NAME', name: '名'.repeat(201) },
  ]);
});

it('submits mixed valid, empty and numeric-code rows and displays each server outcome in English', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.mocked(readXlsxFile).mockResolvedValue([['Customer code', 'Customer name'], ['GOOD', 'Valid'], ['BAD', ''], ['BAD', 'Valid later'], [42, 'Numeric code']]);
  vi.mocked(apiRequest).mockResolvedValue({ created: 2, skipped: 0, failed: 2, items: [{ rowNumber: 2, code: 'GOOD', status: 'CREATED' }, { rowNumber: 3, code: 'BAD', status: 'FAILED' }, { rowNumber: 4, code: 'BAD', status: 'CREATED' }, { rowNumber: 5, code: '', status: 'FAILED' }] });
  const refresh = vi.fn();
  render(<LanguageProvider><CustomerMasterImport onImported={refresh} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: /批量导入客户|Batch import customers/ }));
  expect(screen.getByRole('button', { name: 'Download customer template' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Customer list file'), { target: { files: [new File(['xlsx'], 'customers.xlsx')] } });
  await screen.findByText('Valid later');
  expect(screen.getByText('The code must be text. The server will validate this row.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Import customers' }));
  await screen.findByText('Created 2, duplicate skipped 0, failed 2');
  expect(screen.getAllByText('Created')).toHaveLength(2);
  expect(screen.getAllByText('Failed')).toHaveLength(2);
  expect(refresh).toHaveBeenCalledOnce();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/import', expect.objectContaining({ body: JSON.stringify({ rows: [{ rowNumber: 2, code: 'GOOD', name: 'Valid' }, { rowNumber: 3, code: 'BAD', name: '' }, { rowNumber: 4, code: 'BAD', name: 'Valid later' }, { rowNumber: 5, code: '', name: 'Numeric code' }] }) }));
});

it('keeps safe file-read failures as whole-file rejection without submitting any row', async () => {
  vi.mocked(readXlsxFile).mockRejectedValue(new Error('Excel 解压后内容过大'));
  render(<CustomerMasterImport onImported={vi.fn()} />);
  upload(); await screen.findByText('Excel 解压后内容过大');
  expect(screen.getByRole('button', { name: '导入客户' })).toBeDisabled();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('previews a file and displays all three server outcomes without overwriting duplicate facts', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ created: 1, skipped: 1, failed: 1, items: [{ rowNumber: 2, code: '00042', status: 'CREATED' }, { rowNumber: 3, code: '00042', status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, code: 'BAD', status: 'FAILED', errorCode: 'CUSTOMER_MASTER_IMPORT_ROW_FAILED' }] });
  const refresh = vi.fn();
  render(<CustomerMasterImport onImported={refresh} />);
  upload();
  await screen.findByText('中文客户');
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await screen.findByText('新增 1，重复跳过 1，失败 1');
  expect(screen.getByText('新增成功')).toBeInTheDocument();
  expect(screen.getByText('重复跳过')).toBeInTheDocument();
  expect(screen.getByText('失败')).toBeInTheDocument();
  expect(refresh).toHaveBeenCalledOnce();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/import', expect.objectContaining({ headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ rows: [{ rowNumber: 2, code: '00042', name: '中文客户' }, { rowNumber: 3, code: '00042', name: '不同名称' }] }) }));
});

it('blocks double submission and reuses the original key after an unknown network result', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  vi.mocked(apiRequest).mockReturnValueOnce(pending).mockResolvedValueOnce({ created: 1, skipped: 0, failed: 0, items: [] });
  render(<CustomerMasterImport onImported={vi.fn()} />);
  upload(); await screen.findByText('中文客户');
  const submit = screen.getByRole('button', { name: '导入客户' });
  fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  await act(async () => { reject(new Error('network')); await pending.catch(() => undefined); });
  await waitFor(() => expect(submit).not.toBeDisabled()); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(apiRequest).mock.calls[0]?.[1]?.headers).toEqual(vi.mocked(apiRequest).mock.calls[1]?.[1]?.headers);
});

it('discards a late file parse after switching organization and clears the old preview', async () => {
  let resolve!: (sheet: unknown[][]) => void;
  vi.mocked(readXlsxFile).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = render(<CustomerMasterImport organizationId="org-a" onImported={vi.fn()} />);
  upload(); view.rerender(<CustomerMasterImport organizationId="org-b" onImported={vi.fn()} />);
  await act(async () => { resolve([['客户编码', '客户名称'], ['A', '旧组织客户']]); });
  expect(screen.queryByText('旧组织客户')).not.toBeInTheDocument();
  if (!screen.queryByLabelText('客户清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入客户' }));
  expect(screen.getByRole('button', { name: '导入客户' })).toBeDisabled();
});
