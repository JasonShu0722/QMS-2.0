import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { LanguageProvider } from '../../i18n/Language';
import { SupplierProfilesPage } from './SupplierProfilesPage';

const spreadsheet = vi.hoisted(() => ({ rows: [] as unknown[][], columns: [{}, {}, {}, {}] as { numFmt?: string; width?: number }[] }));
vi.mock('exceljs', () => ({ default: { Workbook: class {
  xlsx = { writeBuffer: async () => new Uint8Array([1]) };
  addWorksheet() { return { columns: spreadsheet.columns, addRow: (row: unknown[]) => spreadsheet.rows.push(row) }; }
} } }));

afterEach(() => vi.unstubAllGlobals());

it.each(['create', 'edit'])('shows success and releases busy after a StrictMode supplier %s', async (action) => {
  const profile = { id: 'p', version: 1, supplierOrganizationId: null, businessCode: 'A', displayName: '甲' };
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : options?.method ? json(profile) : json({ items: [profile], total: 1, canManage: true })));
  render(<StrictMode><SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:read', 'supplier-quality:profiles:write']} /></StrictMode>);
  if (action === 'create') {
    fireEvent.change(screen.getByLabelText('供应商名称'), { target: { value: '新供应商' } });
    fireEvent.change(screen.getByLabelText('业务编码'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '登记供应商' }));
  } else {
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    const editor = within(screen.getByRole('dialog'));
    fireEvent.change(editor.getByLabelText('供应商名称'), { target: { value: '编辑名称' } });
    fireEvent.click(editor.getByRole('button', { name: '保存供应商资料' }));
  }
  await screen.findByText('供应商资料已保存');
  if (action === 'create') expect(screen.getByRole('button', { name: '登记供应商' })).toBeEnabled();
  else await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('registers the actual unsaved guard for a supplier draft', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:write']} /><Link to="/other">离开</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('供应商名称'), { target: { value: '未保存' } });
  fireEvent.click(screen.getByRole('link', { name: '离开' }));
  expect(await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('供应商名称')).toHaveValue('未保存');
});

it('renders the real English supplier profile and import controls', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  try {
    render(<LanguageProvider><SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:write']} /></LanguageProvider>);
    expect(await screen.findByLabelText('Supplier name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register supplier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download supplier template' })).toBeInTheDocument();
    expect(screen.queryByText('登记供应商资料')).not.toBeInTheDocument();
  } finally { localStorage.removeItem('qms:locale:v1'); }
});

it('exports only the authorized current supplier page as literal text', async () => {
  spreadsheet.rows = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:export'; static revokeObjectURL = vi.fn(); });
  const fetcher = vi.fn(async (_path: string) => new Response(JSON.stringify({ items: [{ id: 'p', version: 1, supplierOrganizationId: null, businessCode: '0007', displayName: '=SUM(1,2)', contactName: null, contactEmail: null }], total: 42, canManage: false }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    render(<SupplierProfilesPage organizationId="owner" organizationPermissions={['supplier-quality:profiles:read']} />);
    await screen.findByText('=SUM(1,2)');
    fireEvent.click(screen.getByRole('button', { name: '导出当前页供应商清单' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(spreadsheet.rows).toEqual([['供应商编码', '供应商名称', '联系人', '联系邮箱'], ['0007', '=SUM(1,2)', '', '']]);
    expect(spreadsheet.columns.every((column) => column.numFmt === '@')).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]?.[0]).toContain('organizationId=owner');
  } finally { click.mockRestore(); }
});

it('gives the create and edit forms distinct labels and field IDs', async () => {
  const profile = { id: 'profile-one', version: 1, supplierOrganizationId: 'supplier-one', businessCode: 'SQ-001', displayName: '供应商甲', contactName: '原联系人' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.includes('supplier-options') ? { items: [], total: 0 } : { items: [profile], total: 1, canManage: true }), { headers: { 'content-type': 'application/json' } })));
  render(<SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:read', 'supplier-quality:profiles:write']} />);
  fireEvent.click(await screen.findByText('编辑资料'));
  const title = await screen.findByText('编辑供应商资料');
  const editor = within(title.closest('[role="dialog"]') as HTMLElement);
  expect(editor.getByLabelText('联系人', { exact: true })).toHaveValue('原联系人');
  const fields = [...document.querySelectorAll('input[id]')].map((field) => field.id);
  expect(new Set(fields).size).toBe(fields.length);
});

it('keeps the edited supplier name after a CAS conflict and a failed explicit reload', async () => {
  const profile = { id: 'p', version: 1, supplierOrganizationId: null, businessCode: 'A', displayName: '甲' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'PUT') return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
    if (path.endsWith('/profiles/p')) throw new TypeError('offline');
    return json({ items: [profile], total: 1, canManage: true });
  }));
  render(<SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:read', 'supplier-quality:profiles:write']} />);
  fireEvent.click(await screen.findByText('编辑资料'));
  const editor = within(screen.getByRole('dialog'));
  fireEvent.change(editor.getByLabelText('供应商名称'), { target: { value: '保留的草稿' } });
  fireEvent.click(editor.getByRole('button', { name: '保存供应商资料' }));
  await editor.findByText('当前填写内容已保留，请显式重新加载后再编辑。');
  fireEvent.click(editor.getByRole('button', { name: '重新加载资料' }));
  const confirms = await screen.findAllByRole('button', { name: '重新加载' });
  fireEvent.click(confirms[confirms.length - 1]!);
  await editor.findByText('加载或保存失败，请重试');
  expect(editor.getByLabelText('供应商名称')).toHaveValue('保留的草稿');
});

it('reloads the supplier version without dropping the draft or automatically saving it', async () => {
  const profile = { id: 'p', version: 1, supplierOrganizationId: null, businessCode: 'A', displayName: '甲' };
  const writes: RequestInit[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (options?.method === 'PUT') { writes.push(options); return writes.length === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json({ ...profile, version: 3 }); }
    if (path.endsWith('/profiles/p')) return json({ ...profile, version: 2, displayName: '其他人改名' });
    return json({ items: [profile], total: 1, canManage: true });
  }));
  render(<SupplierProfilesPage organizationPermissions={['supplier-quality:profiles:read', 'supplier-quality:profiles:write']} />);
  fireEvent.click(await screen.findByText('编辑资料'));
  const editor = within(screen.getByRole('dialog'));
  fireEvent.change(editor.getByLabelText('供应商名称'), { target: { value: '我的名称草稿' } });
  fireEvent.click(editor.getByRole('button', { name: '保存供应商资料' }));
  await editor.findByText('当前填写内容已保留，请显式重新加载后再编辑。');
  fireEvent.click(editor.getByRole('button', { name: '重新加载资料' }));
  const confirms = await screen.findAllByRole('button', { name: '重新加载' }); fireEvent.click(confirms[confirms.length - 1]!);
  await waitFor(() => expect(editor.getByRole('button', { name: '保存供应商资料' })).toBeEnabled());
  await waitFor(() => expect(editor.getByLabelText('供应商名称')).toHaveValue('我的名称草稿'));
  expect(writes).toHaveLength(1);
  fireEvent.click(editor.getByRole('button', { name: '保存供应商资料' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(JSON.parse(writes[1]!.body as string)).toMatchObject({ expectedVersion: 2, displayName: '我的名称草稿' });
});

it('ignores a late list response from the previously selected organization', async () => {
  let oldResponse!: (value: Response) => void;
  const json = (name: string) => new Response(JSON.stringify({ items: [{ id: name, businessCode: name, displayName: name, version: 1, supplierOrganizationId: null }], total: 1, canManage: false }), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn((path: string) => path.includes('organizationId=old') ? new Promise<Response>((resolve) => { oldResponse = resolve; }) : Promise.resolve(json('新组织资料'))));
  const { rerender } = render(<SupplierProfilesPage organizationId="old" organizationPermissions={['supplier-quality:profiles:read']} />);
  rerender(<SupplierProfilesPage organizationId="new" organizationPermissions={['supplier-quality:profiles:read']} />);
  expect((await screen.findAllByText('新组织资料')).length).toBeGreaterThan(0);
  oldResponse(json('旧组织资料'));
  await waitFor(() => expect(screen.queryByText('旧组织资料')).not.toBeInTheDocument());
});

it('creates an independent supplier without selecting an enterprise', async () => {
  const requests: { path: string; body?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    requests.push({ path, body: options?.body as string });
    return new Response(JSON.stringify(path.endsWith('/csrf') ? { csrfToken: 'csrf' } : { items: [], total: 0, canManage: true }), { headers: { 'content-type': 'application/json' } });
  }));
  render(<SupplierProfilesPage organizationId="owner" organizationPermissions={['supplier-quality:profiles:write']} />);
  fireEvent.change(await screen.findByLabelText('供应商名称'), { target: { value: '独立供应商' } });
  fireEvent.change(screen.getByLabelText('业务编码'), { target: { value: '0007' } });
  fireEvent.click(screen.getByRole('button', { name: '登记供应商' }));
  await screen.findByText('供应商资料已保存');
  const request = requests.find((item) => item.body?.includes('0007'));
  expect(JSON.parse(request!.body!)).toMatchObject({ organizationId: 'owner', businessCode: '0007', displayName: '独立供应商' });
  expect(JSON.parse(request!.body!)).not.toHaveProperty('supplierOrganizationId');
  expect(requests.some((item) => item.path.includes('supplier-options') || item.path.includes('profiles?'))).toBe(false);
});
