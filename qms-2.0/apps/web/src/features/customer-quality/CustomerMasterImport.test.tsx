import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { CustomerMasterImport, parseCustomerMasterRows } from './CustomerMasterImport';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(readXlsxFile).mockReset().mockResolvedValue([['客户编码', '客户名称'], ['00042', '中文客户'], ['00042', '不同名称']]);
});
const upload = () => fireEvent.change(screen.getByLabelText('客户清单文件'), { target: { files: [new File(['xlsx'], 'customers.xlsx')] } });

it('maps only code/name, preserves leading zeroes and spreadsheet row numbers', () => {
  expect(parseCustomerMasterRows([['客户名称', '客户编码'], [' 中文客户 ', '00042'], [], ['二客户', 'abc']])).toEqual([
    { rowNumber: 2, code: '00042', name: '中文客户' }, { rowNumber: 4, code: 'abc', name: '二客户' },
  ]);
  for (const sheet of [[], [['客户编码', '关系']], [['客户编码', '客户名称'], [42, '客户']], [['客户编码', '客户名称'], [{ formula: '1+1', result: 2 }, '客户']], [['客户编码', '客户名称'], ['code', '']]]) expect(() => parseCustomerMasterRows(sheet)).toThrow();
  expect(() => parseCustomerMasterRows([['客户编码', '客户名称'], ...Array.from({ length: 101 }, () => ['code', 'name'])])).toThrow('1–100');
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
  expect(screen.getByRole('button', { name: '导入客户' })).toBeDisabled();
});
