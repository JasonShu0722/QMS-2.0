import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerMasterSection } from './CustomerMasterSection';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

const spreadsheet = vi.hoisted(() => ({ rows: [] as unknown[][], columns: [{ numFmt: '' }, { numFmt: '' }], writeBuffer: vi.fn(async () => new Uint8Array([1])) }));
vi.mock('exceljs', () => ({ default: { Workbook: class {
  xlsx = { writeBuffer: spreadsheet.writeBuffer };
  addWorksheet() { return { addRow: (row: unknown[]) => spreadsheet.rows.push(row), columns: spreadsheet.columns }; }
} } }));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});
const customer = { id: 'customer-1', code: 'C-1', name: '客户一', active: true, version: 1 };
const otherCustomer = { id: 'customer-2', code: 'C-2', name: '客户二', active: true, version: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
async function selectCustomer(label: string) {
  fireEvent.mouseDown(await screen.findByLabelText('选择客户'));
  fireEvent.click(await screen.findByText(label));
}
beforeEach(() => {
  spreadsheet.rows = []; spreadsheet.columns.forEach((column) => { column.numFmt = ''; });
  spreadsheet.writeBuffer.mockReset().mockResolvedValue(new Uint8Array([1]));
  vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/my-permissions') ? { permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] } : path.endsWith('/customers') ? [customer] : []));
});

it('keeps the embedded customer heading accessible without a duplicate visible title', async () => {
  render(<CustomerMasterSection embedded organizationPermissions={['customer-quality:complaints:read']} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前客户清单' })).toBeEnabled());
  const heading = screen.getByRole('heading', { name: '客户主数据', level: 3 });
  expect(heading).toHaveClass('sr-only');
  expect(heading.parentElement).toBe(screen.getByRole('region', { name: '客户主数据' }));
});

it('retains the visible customer section heading for callers without a containing page title', async () => {
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:read']} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前客户清单' })).toBeEnabled());
  expect(screen.getByRole('heading', { name: '客户主数据', level: 3 })).not.toHaveClass('sr-only');
});

it('disables export before loading and after an authorized list refresh fails, rather than exporting stale or empty data', async () => {
  const first = deferred<unknown[]>();
  vi.mocked(apiRequest).mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([]);
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:read']} />);
  const button = screen.getByRole('button', { name: '导出当前客户清单' });
  expect(button).toBeDisabled();
  await act(async () => { first.resolve([customer]); await first.promise; });
  expect(button).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '刷新客户' }));
  expect(button).toBeDisabled();
  await screen.findByText('请求失败，请重试');
  fireEvent.click(button);
  expect(spreadsheet.writeBuffer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '刷新客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
  expect(button).toBeDisabled();
});

it('restores export after a failed refresh only when both customers and current permissions are revalidated', async () => {
  const revalidatedPermissions = deferred<{ permissions: string[] }>();
  let customerReads = 0;
  let permissionReads = 0;
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (path.endsWith('/my-permissions')) {
      permissionReads++;
      return permissionReads === 3 ? revalidatedPermissions.promise : Promise.resolve({ permissions: ['customer-quality:complaints:read'] });
    }
    if (path.endsWith('/customers')) {
      customerReads++;
      return customerReads === 2 ? Promise.reject(new Error('network')) : Promise.resolve([customer]);
    }
    return Promise.resolve([]);
  });
  render(<CustomerMasterSection />);
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前客户清单' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: '刷新客户' }));
  await screen.findByText('请求失败，请重试');
  expect(screen.getByRole('button', { name: '导出当前客户清单' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(permissionReads).toBe(3));
  expect(customerReads).toBe(2);
  expect(screen.getByRole('button', { name: '导出当前客户清单' })).toBeDisabled();
  await act(async () => { revalidatedPermissions.resolve({ permissions: ['customer-quality:complaints:read'] }); await revalidatedPermissions.promise; });
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前客户清单' })).not.toBeDisabled());
  expect(permissionReads).toBe(3);
});

it('does not offer list export with only import/write permission', async () => {
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:write']} />);
  expect(apiRequest).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '导出当前客户清单' })).not.toBeInTheDocument();
});

it('discards a generated export when its list has been refreshed before download completes', async () => {
  const bytes = deferred<Uint8Array>();
  spreadsheet.writeBuffer.mockReturnValueOnce(bytes.promise);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:customers') });
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:read']} />);
  const button = screen.getByRole('button', { name: '导出当前客户清单' });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(spreadsheet.writeBuffer).toHaveBeenCalledOnce());
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: '刷新客户' }));
  await screen.findByText('请求失败，请重试');
  await act(async () => { bytes.resolve(new Uint8Array([1])); await bytes.promise; });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('reports export failure and revokes the blob URL even if the browser download fails', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:customers') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('download'); });
  try {
    render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:read']} />);
    const button = screen.getByRole('button', { name: '导出当前客户清单' });
    await waitFor(() => expect(button).not.toBeDisabled()); fireEvent.click(button);
    await screen.findByText('客户清单导出失败，请重试');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:customers');
  } finally { click.mockRestore(); }
});

it('exports only the loaded authorized organization customer code and name as text', async () => {
  vi.mocked(apiRequest).mockResolvedValue([{ ...customer, code: '00042', name: '=1+1' }]);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:customers') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  try {
    render(<CustomerMasterSection organizationId="org-a" organizationPermissions={['customer-quality:complaints:read']} />);
    const button = screen.getByRole('button', { name: '导出当前客户清单' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(spreadsheet.rows).toEqual([['客户编码', '客户名称'], ['00042', '=1+1']]);
    expect(spreadsheet.columns.every((column) => column.numFmt === '@')).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:customers');
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith('/api/v1/customer-quality/customers?organizationId=org-a');
  } finally { click.mockRestore(); }
});
afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });

it('lists customer relations and gates writes by permission', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/my-permissions') ? { permissions: ['customer-quality:complaints:read'] } : path.endsWith('/customers') ? [customer] : []));
  render(<CustomerMasterSection />);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers'));
  expect(screen.queryByRole('button', { name: '新增客户' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增关系' })).not.toBeInTheDocument();
});

it('uses the selected admin organization permissions instead of the home context', async () => {
  render(<CustomerMasterSection organizationId="org-selected" organizationPermissions={['customer-quality:complaints:read']} />);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers?organizationId=org-selected'));
  expect(screen.queryByRole('button', { name: '新增客户' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/my-permissions'))).toBe(false);
});

it('enables writes from the selected admin organization permissions', async () => {
  render(<CustomerMasterSection organizationId="org-selected" organizationPermissions={['customer-quality:complaints:read', 'customer-quality:complaints:write']} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '新增客户' })).toBeInTheDocument());
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/my-permissions'))).toBe(false);
});

it('creates customer with CSRF and idempotency', async () => {
  render(<CustomerMasterSection />);
  await waitFor(() => expect(screen.getByRole('button', { name: '新增客户' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '新增客户' }));
  fireEvent.change(screen.getByLabelText('客户代码'), { target: { value: 'C-2' } });
  fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '客户二' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) => path.endsWith('/customers') && options?.method === 'POST')).toBe(true));
  const call = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path.endsWith('/customers') && options?.method === 'POST');
  expect(call?.[1]).toMatchObject({ headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ code: 'C-2', name: '客户二' }) });
});

it('offers the same customer batch import in the existing master section', async () => {
  render(<CustomerMasterSection />);
  await screen.findByRole('button', { name: '新增客户' });
  fireEvent.click(screen.getByRole('button', { name: '批量导入客户' }));
  expect(screen.getByLabelText('客户清单文件')).toHaveAttribute('accept', '.xlsx');
  expect(screen.getByRole('button', { name: '导入客户' })).toBeDisabled();
});

it('edits a customer through a controlled dialog with CAS', async () => {
  render(<CustomerMasterSection />);
  await waitFor(() => expect(screen.getByRole('button', { name: '新增客户' })).toBeInTheDocument());
  fireEvent.mouseDown(screen.getByLabelText('选择客户'));
  fireEvent.click(await screen.findByText('C-1 · 客户一'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/customer-1/relations'));
  fireEvent.click(screen.getByRole('button', { name: '编辑客户' }));
  fireEvent.change(screen.getByLabelText('编辑名称'), { target: { value: '客户甲' } });
  fireEvent.click(await screen.findByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) => path.endsWith(`/customers/${customer.id}`) && options?.method === 'PUT')).toBe(true));
  const call = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path.endsWith(`/customers/${customer.id}`) && options?.method === 'PUT');
  expect(call?.[1]?.body).toBe(JSON.stringify({ expectedVersion: 1, name: '客户甲' }));
});

it('keeps the selected customer relations when an earlier customer GET finishes late', async () => {
  const firstRelations = deferred<unknown[]>();
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (path.endsWith('/my-permissions')) return Promise.resolve({ permissions: ['customer-quality:complaints:read'] });
    if (path.endsWith('/customers')) return Promise.resolve([customer, otherCustomer]);
    if (path.endsWith('/customer-1/relations')) return firstRelations.promise;
    if (path.endsWith('/customer-2/relations')) return Promise.resolve([{ id: 'relation-2', relation_type: 'PRODUCT', related_code: 'B-P', related_name: '客户二产品', version: 1 }]);
    return Promise.resolve([]);
  });
  render(<CustomerMasterSection />);
  await selectCustomer('C-1 · 客户一');
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/customer-1/relations'));
  await selectCustomer('C-2 · 客户二');
  expect(await screen.findByText('B-P · 客户二产品')).toBeInTheDocument();
  await act(async () => { firstRelations.resolve([{ id: 'relation-1', relation_type: 'PRODUCT', related_code: 'A-P', related_name: '客户一产品', version: 1 }]); await firstRelations.promise; });
  expect(screen.queryByText('A-P · 客户一产品')).not.toBeInTheDocument();
  expect(screen.getByText('B-P · 客户二产品')).toBeInTheDocument();
});

it('does not replace the new customer relations after an earlier customer POST finishes late', async () => {
  const firstPost = deferred<unknown>();
  vi.mocked(apiRequest).mockImplementation((path, options) => {
    if (path.endsWith('/my-permissions')) return Promise.resolve({ permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] });
    if (path.endsWith('/customers')) return Promise.resolve([customer, otherCustomer]);
    if (path.endsWith('/customer-1/relations') && options?.method === 'POST') return firstPost.promise;
    if (path.endsWith('/customer-1/relations')) return Promise.resolve([]);
    if (path.endsWith('/customer-2/relations')) return Promise.resolve([{ id: 'relation-2', relation_type: 'PRODUCT', related_code: 'B-P', related_name: '客户二产品', version: 1 }]);
    return Promise.resolve([]);
  });
  render(<CustomerMasterSection />);
  await selectCustomer('C-1 · 客户一');
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/customer-1/relations'));
  fireEvent.mouseDown(screen.getByLabelText('关系类型'));
  fireEvent.click(await screen.findByText('产品'));
  fireEvent.change(screen.getByLabelText('关系代码'), { target: { value: 'A-P' } });
  fireEvent.change(screen.getByLabelText('关系名称'), { target: { value: '客户一产品' } });
  fireEvent.click(screen.getByRole('button', { name: '新增关系' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) => path.endsWith('/customer-1/relations') && options?.method === 'POST')).toBe(true));
  await selectCustomer('C-2 · 客户二');
  expect(await screen.findByText('B-P · 客户二产品')).toBeInTheDocument();
  expect(screen.getByLabelText('关系代码')).toHaveValue('');
  expect(screen.getByLabelText('关系名称')).toHaveValue('');
  await act(async () => { firstPost.resolve({}); await firstPost.promise; });
  await waitFor(() => expect(screen.getByRole('button', { name: /新增关系/ })).not.toBeDisabled());
  expect(screen.getByText('B-P · 客户二产品')).toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) => path.endsWith('/customer-1/relations') && !options?.method)).toHaveLength(1);
});
it('REQ0019 opens create in a modal and never requests a list for write-only permission', async () => {
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:write']} />);
  expect(screen.queryByLabelText('客户代码')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('客户清单文件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '新增客户' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('protects an unfinished customer relation when navigating away', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><CustomerMasterSection /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  await selectCustomer('C-1 · 客户一');
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/customers/customer-1/relations'));
  fireEvent.change(screen.getByLabelText('关系代码'), { target: { value: 'UNSAVED-PRODUCT' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('关系代码')).toHaveValue('UNSAVED-PRODUCT');
});

it('REQ0019 saves two write-only customers without requesting a forbidden list', async () => {
  render(<CustomerMasterSection organizationPermissions={['customer-quality:complaints:write']} />);
  for (const code of ['FIRST', 'SECOND']) {
    fireEvent.click(screen.getByRole('button', { name: '新增客户' }));
    fireEvent.change(screen.getByLabelText('客户代码'), { target: { value: code } });
    fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '客户' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
});

it('REQ0019 preserves known write permission and import access after a list failure', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path.includes('my-permissions')) return { permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] };
    throw new Error('network');
  });
  render(<CustomerMasterSection />);
  await screen.findByText('请求失败，请重试');
  expect(screen.getByRole('button', { name: '新增客户' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '批量导入客户' })).toBeInTheDocument();
});
