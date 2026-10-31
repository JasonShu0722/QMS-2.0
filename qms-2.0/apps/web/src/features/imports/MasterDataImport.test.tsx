import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { readXlsxFile } from './read-xlsx';
import { CustomerMasterImport } from '../customer-quality/CustomerMasterImport';
import { SupplierMasterImport } from '../supplier-quality/SupplierMasterImport';
import { MaterialMasterImport } from '../material-master/MaterialMasterImport';

vi.mock('./read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
const deferred = () => { let resolve!: (value: unknown) => void; let reject!: (cause: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const receipt = (start: number, count: number) => ({ created: count, skipped: 0, failed: 0, items: Array.from({ length: count }, (_, i) => ({ rowNumber: start + i, code: `00${start + i}`, status: 'CREATED' })) });
const openUpload = async (domain = '客户') => {
  fireEvent.click(screen.getByRole('button', { name: `批量导入${domain}` }));
  fireEvent.change(screen.getByLabelText(`${domain}清单文件`), { target: { files: [new File(['xlsx'], 'masters.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: `导入${domain === '物料' ? '物料' : domain}` })).toBeEnabled());
};
beforeEach(() => {
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset();
  vi.mocked(readXlsxFile).mockReset().mockResolvedValue([['客户编码', '客户名称'], ...Array.from({ length: 250 }, (_, i) => [`00${i + 2}`, `客户${i}`])]);
});

it('C SPEC import warning follows initial pending unknown and settled states', async () => {
  const pending = deferred();
  vi.mocked(readXlsxFile).mockResolvedValue([['物料编码', '物料名称'], ['0002', '物料']]);
  vi.mocked(apiRequest).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt(2, 1));
  render(<MaterialMasterImport onImported={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  const importer = within(await screen.findByRole('region', { name: '物料批量新增' }));
  expect(importer.queryByText(/当前请求可能已提交/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('物料清单文件'), { target: { files: [new File(['xlsx'], 'material.xlsx')] } });
  await waitFor(() => expect(importer.getByRole('button', { name: '导入物料' })).toBeEnabled());
  expect(importer.queryByText(/当前请求可能已提交/)).not.toBeInTheDocument();
  await waitFor(() => expect(importer.getByText('尚有未导入行；离开页面将停止后续批次。')).toBeVisible());
  fireEvent.click(importer.getByRole('button', { name: '导入物料' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  expect(importer.getByText(/当前请求可能已提交/)).toBeVisible();
  await act(async () => pending.reject(new TypeError('offline')));
  await importer.findByText('当前批次结果未知，请使用原批次重试；已确认结果保留。');
  expect(importer.getByText(/当前请求可能已提交/)).toBeVisible();
  fireEvent.click(importer.getByRole('button', { name: '导入物料' }));
  await importer.findByText('已确认 1 / 1，未处理 0');
  await waitFor(() => expect(importer.queryByText(/当前请求可能已提交/)).not.toBeInTheDocument());
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]![1]!.body).toBe(calls[0]![1]!.body);
  expect(calls[1]![1]!.headers).toEqual(calls[0]![1]!.headers);
});

it('opens only on demand and strictly serializes 250 rows with cumulative acknowledged progress', async () => {
  const first = deferred(); const second = deferred();
  vi.mocked(apiRequest).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(receipt(202, 50));
  render(<CustomerMasterImport organizationId="org" onImported={vi.fn()} />);
  expect(screen.queryByLabelText('客户清单文件')).not.toBeInTheDocument();
  await openUpload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  expect(screen.getByText('已确认 0 / 250，未处理 250')).toBeInTheDocument();
  await act(async () => first.resolve(receipt(2, 100)));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(screen.getByText('已确认 100 / 250，未处理 150')).toBeInTheDocument();
  await act(async () => second.resolve(receipt(102, 100)));
  await screen.findByText('已确认 250 / 250，未处理 0');
  expect(vi.mocked(apiRequest).mock.calls.map(([, init]) => JSON.parse(init!.body as string).rows.length)).toEqual([100, 100, 50]);
});

it('retains the unknown body/key through closing and reopens for explicit retry without counting it complete', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(receipt(2, 100)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(receipt(102, 100)).mockResolvedValueOnce(receipt(202, 50));
  render(<CustomerMasterImport onImported={vi.fn()} />); await openUpload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await screen.findByText('当前批次结果未知，请使用原批次重试；已确认结果保留。');
  expect(screen.getByText('已确认 100 / 250，未处理 150')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: '客户批量新增' })).getByRole('button', { name: /关\s*闭/ }));
  fireEvent.click(screen.getByRole('button', { name: '批量导入客户' }));
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await screen.findByText('已确认 250 / 250，未处理 0');
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls[1]?.[1]?.body).toBe(calls[2]?.[1]?.body);
  expect(calls[1]?.[1]?.headers).toEqual(calls[2]?.[1]?.headers);
  expect(calls[0]?.[1]?.headers).not.toEqual(calls[1]?.[1]?.headers);
});

it.each([false, true])('confirms termination after current request; cancel continues: stop=%s', async (stop) => {
  const first = deferred();
  vi.mocked(apiRequest).mockReturnValueOnce(first.promise).mockResolvedValueOnce(receipt(102, 100)).mockResolvedValueOnce(receipt(202, 50));
  render(<CustomerMasterImport onImported={vi.fn()} />); await openUpload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '终止导入' }));
  await screen.findByText('终止后已提交的数据保留，当前请求完成后停止其余批次。');
  fireEvent.click(screen.getByRole('button', { name: stop ? '确认终止' : '继续导入' }));
  await act(async () => first.resolve(receipt(2, 100)));
  await screen.findByText(stop ? '已确认 100 / 250，未处理 150' : '已确认 250 / 250，未处理 0');
  expect(apiRequest).toHaveBeenCalledTimes(stop ? 1 : 3);
});

it('waits for the stop decision even when the active request finishes first', async () => {
  const first = deferred();
  vi.mocked(apiRequest).mockReturnValueOnce(first.promise).mockResolvedValueOnce(receipt(102, 100)).mockResolvedValueOnce(receipt(202, 50));
  render(<CustomerMasterImport onImported={vi.fn()} />); await openUpload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '终止导入' }));
  await act(async () => first.resolve(receipt(2, 100)));
  expect(apiRequest).toHaveBeenCalledOnce();
  expect(screen.getByText('已确认 100 / 250，未处理 150')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续导入' }));
  await screen.findByText('已确认 250 / 250，未处理 0');
});

it('does not send subsequent requests or refresh after unmount while an acknowledgement is pending', async () => {
  const first = deferred(); const refresh = vi.fn();
  vi.mocked(apiRequest).mockReturnValueOnce(first.promise);
  const view = render(<CustomerMasterImport onImported={refresh} />); await openUpload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  view.unmount(); await act(async () => first.resolve(receipt(2, 100)));
  expect(apiRequest).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
});

it.each(['供应商', '客户', '物料'])('keeps %s receipt when refreshing the list fails', async (domain) => {
  vi.mocked(readXlsxFile).mockResolvedValue([[`${domain}编码`, `${domain}名称`, ...(domain === '供应商' ? ['联系人', '联系邮箱'] : [])], ['0002', '名称']]);
  vi.mocked(apiRequest).mockResolvedValue(receipt(2, 1));
  const Component = domain === '供应商' ? SupplierMasterImport : domain === '客户' ? CustomerMasterImport : MaterialMasterImport;
  render(<Component onImported={async () => { throw new Error('refresh failed'); }} />); await openUpload(domain);
  fireEvent.click(screen.getByRole('button', { name: `导入${domain}` }));
  await screen.findByText('新增 1，重复跳过 0，失败 0');
  await screen.findByText('导入回执已保留，列表刷新失败，请稍后刷新列表。');
  expect(apiRequest).toHaveBeenCalledOnce();
});
