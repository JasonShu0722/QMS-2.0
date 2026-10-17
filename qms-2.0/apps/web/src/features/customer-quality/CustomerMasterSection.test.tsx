import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerMasterSection } from './CustomerMasterSection';

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
  fireEvent.mouseDown(screen.getByLabelText('选择客户'));
  fireEvent.click(await screen.findByText(label));
}
beforeEach(() => {
  vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/my-permissions') ? { permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] } : path.endsWith('/customers') ? [customer] : []));
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
  fireEvent.change(screen.getByLabelText('客户代码'), { target: { value: 'C-2' } });
  fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '客户二' } });
  fireEvent.click(screen.getByRole('button', { name: '新增客户' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) => path.endsWith('/customers') && options?.method === 'POST')).toBe(true));
  const call = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path.endsWith('/customers') && options?.method === 'POST');
  expect(call?.[1]).toMatchObject({ headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ code: 'C-2', name: '客户二' }) });
});

it('offers the same customer batch import in the existing master section', async () => {
  render(<CustomerMasterSection />);
  await screen.findByRole('button', { name: '新增客户' });
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
