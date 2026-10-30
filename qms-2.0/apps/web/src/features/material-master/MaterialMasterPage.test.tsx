import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, csrfToken } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { MaterialMasterPage } from './MaterialMasterPage';
import { MaterialMasterImport, parseMaterialMasterRows } from './MaterialMasterImport';
import { LanguageProvider } from '../../i18n/Language';
import { AdminPage } from '../admin/AdminPage';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import userEvent from '@testing-library/user-event';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
const spreadsheet = vi.hoisted(() => ({ rows: [] as unknown[][], columns: [] as { width?: number; numFmt?: string }[], writeBuffer: vi.fn(async () => new Uint8Array([1, 2])) }));
vi.mock('exceljs', () => ({ default: { Workbook: class {
  xlsx = { writeBuffer: spreadsheet.writeBuffer };
  addWorksheet() {
    spreadsheet.columns = [{}, {}];
    return { columns: spreadsheet.columns, addRow: (row: unknown[]) => spreadsheet.rows.push(row) };
  }
} } }));
const permissions = ['material-master:read', 'material-master:write', 'material-master:import'];
const material = { id: 'material-1', materialCode: '00042', materialName: '原物料', version: 4 };
beforeEach(() => {
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => path === '/api/v1/material-masters' ? [material] : {});
  vi.mocked(readXlsxFile).mockReset().mockResolvedValue([['物料编码', '物料名称'], ['00042', '中文物料'], ['00042', '不同名称']]);
  spreadsheet.rows = []; spreadsheet.writeBuffer.mockClear();
});
const upload = () => { if (!screen.queryByLabelText('物料清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入物料' })); fireEvent.change(screen.getByLabelText('物料清单文件'), { target: { files: [new File(['xlsx'], 'materials.xlsx')] } }); };

it('keeps the material section heading accessible without a duplicate visible title', async () => {
  render(<MaterialMasterPage organizationPermissions={permissions} />);
  await screen.findByText('原物料');
  const heading = screen.getByRole('heading', { name: '物料主数据', level: 3 });
  expect(heading).toHaveClass('sr-only');
  expect(heading.parentElement).toBe(screen.getByRole('region', { name: '物料主数据' }));
  expect(screen.getByText(/编码区分大小写/)).toHaveTextContent('仅维护物料编码和物料名称；编码区分大小写，前导 0 原样保留。');
  expect(screen.getByText(/编码区分大小写/)).not.toHaveTextContent('一期');
});

it('shows two fields only and creates string codes through the generated contract', async () => {
  render(<MaterialMasterPage organizationPermissions={permissions} />);
  await screen.findByText('原物料');
  fireEvent.click(screen.getByRole('button', { name: '新增物料' }));
  fireEvent.change(screen.getByLabelText('物料编码'), { target: { value: '00043' } });
  fireEvent.change(screen.getByLabelText('物料名称'), { target: { value: '中文新物料' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/material-masters', expect.objectContaining({ method: 'POST', body: JSON.stringify({ materialCode: '00043', materialName: '中文新物料' }) })));
  expect(screen.queryByText('单位')).not.toBeInTheDocument();
  expect(screen.queryByText('删除')).not.toBeInTheDocument();
  expect(screen.queryByText('启停')).not.toBeInTheDocument();
});

it('allows write-only users to create twice without requesting a forbidden list', async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => {
    if (init?.method === 'POST') return material;
    throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  });
  render(<LanguageProvider><MaterialMasterPage organizationPermissions={['material-master:write']} /></LanguageProvider>);
  for (const code of ['FIRST', 'SECOND']) {
    fireEvent.click(screen.getByRole('button', { name: '新增物料' }));
    fireEvent.change(screen.getByLabelText('物料编码'), { target: { value: code } });
    fireEvent.change(screen.getByLabelText('物料名称'), { target: { value: `物料${code}` } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '新增物料' })).not.toBeDisabled());
  }
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
});

it('renames using the selected version and retains the draft on a stale version conflict', async () => {
  render(<MaterialMasterPage organizationPermissions={permissions} />);
  await screen.findByText('原物料'); fireEvent.click(screen.getByRole('button', { name: /改\s*名/ }));
  fireEvent.change(screen.getByLabelText('编辑物料名称'), { target: { value: '新物料' } });
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/material-masters/material-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ materialName: '新物料', expectedVersion: 4 }) })));
  expect(screen.getByLabelText('编辑物料名称')).toHaveValue('新物料');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('explicitly reloads the current version without losing the name draft and saves only on a second user action', async () => {
  render(<MaterialMasterPage organizationPermissions={permissions} />);
  await screen.findByText('原物料'); fireEvent.click(screen.getByRole('button', { name: /改\s*名/ }));
  fireEvent.change(screen.getByLabelText('编辑物料名称'), { target: { value: '我的草稿' } });
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1));
  vi.mocked(apiRequest).mockResolvedValueOnce([{ ...material, materialName: '其他人修改', version: 5 }]);
  fireEvent.click(screen.getByRole('button', { name: '重新加载物料版本' }));
  await screen.findByText('其他人修改');
  expect(screen.getByLabelText('编辑物料名称')).toHaveValue('我的草稿');
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2));
  const requests = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(requests[1]?.[1]?.body).toBe(JSON.stringify({ materialName: '我的草稿', expectedVersion: 5 }));
  expect(requests[0]?.[1]?.headers).not.toEqual(requests[1]?.[1]?.headers);
});

it('renders the real English page and import outcomes through LanguageProvider', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  try {
    const view = render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MaterialMasterPage organizationPermissions={permissions} /></LanguageProvider></ConfigProvider>);
    await screen.findByRole('heading', { name: 'Material masters' });
    const page = within(view.container);
    const add = page.getByRole('button', { name: 'Add material' });
    expect(add).toBeInTheDocument();
    fireEvent.click(add);
    const createDialog = screen.getByRole('dialog');
    expect(within(createDialog).getByLabelText('Material code')).toBeInTheDocument();
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(createDialog).not.toBeVisible());
    fireEvent.click(page.getByRole('button', { name: /批量导入物料|Batch import materials/ }));
    const importer = within(screen.getByRole('dialog'));
    expect(importer.getByRole('button', { name: 'Download material template' })).toBeInTheDocument();
    expect(screen.queryByText('物料主数据')).not.toBeInTheDocument();
    fireEvent.change(importer.getByLabelText('Material list file'), { target: { files: [new File(['xlsx'], 'materials.xlsx')] } });
    await importer.findByText('中文物料');
    vi.mocked(apiRequest).mockResolvedValueOnce({ created: 1, skipped: 1, failed: 1, items: [{ rowNumber: 2, code: '00042', status: 'CREATED' }, { rowNumber: 3, code: '00042', status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, code: 'BAD', status: 'FAILED' }] });
    fireEvent.click(importer.getByRole('button', { name: 'Import materials' }));
    await importer.findByText('Created 1, duplicate skipped 1, failed 1');
    expect(importer.getByText('Duplicate skipped')).toBeInTheDocument();
  } finally { localStorage.removeItem('qms:locale:v1'); }
});

it('keeps import separate from manual-write permission and hides inaccessible data', async () => {
  const view = render(<MaterialMasterPage organizationPermissions={['material-master:read']} />);
  await screen.findByText('原物料');
  expect(screen.queryByRole('button', { name: '新增物料' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('物料清单文件')).not.toBeInTheDocument();
  view.rerender(<MaterialMasterPage organizationPermissions={['material-master:read', 'material-master:import']} />);
  fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  expect(screen.getByLabelText('物料清单文件')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增物料' })).not.toBeInTheDocument();
});

it('discards late list responses and edit drafts after switching organization', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementation((path) => path.endsWith('org-a') ? new Promise((done) => { resolve = done; }) : Promise.resolve([{ ...material, id: 'other', materialName: '新组织物料' }]));
  const view = render(<MaterialMasterPage organizationId="org-a" organizationPermissions={permissions} />);
  view.rerender(<MaterialMasterPage organizationId="org-b" organizationPermissions={permissions} />);
  await screen.findByText('新组织物料');
  await act(async () => { resolve([{ ...material, materialName: '旧组织物料' }]); });
  expect(screen.queryByText('旧组织物料')).not.toBeInTheDocument();
});

it('maps exactly the two columns, preserves case/zeroes and rejects formula or extra cells', () => {
  expect(parseMaterialMasterRows([['物料名称', '物料编码'], [' 中文物料 ', '00042'], [], ['字母', 'aBc']])).toEqual([{ rowNumber: 2, materialCode: '00042', materialName: '中文物料' }, { rowNumber: 4, materialCode: 'aBc', materialName: '字母' }]);
  for (const sheet of [[], [['物料编码', '单位']], [['物料编码', '物料名称'], [{ formula: '1+1', result: 2 }, '物料']], [['物料编码', '物料名称'], ['code', '', '额外']]]) expect(() => parseMaterialMasterRows(sheet)).toThrow();
  expect(parseMaterialMasterRows([['物料编码', '物料名称'], ...Array.from({ length: 101 }, () => ['code', 'name'])])).toHaveLength(101);
});

it('keeps invalid business rows for independent server validation without converting numeric codes', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['物料编码', '物料名称'], ['GOOD', '合法'], ['BAD', ''], ['BAD', '合法后续'], [42, '数字编码']]);
  vi.mocked(apiRequest).mockResolvedValue({ created: 2, skipped: 0, failed: 2, items: [{ rowNumber: 2, code: 'GOOD', status: 'CREATED' }, { rowNumber: 3, code: 'BAD', status: 'FAILED' }, { rowNumber: 4, code: 'BAD', status: 'CREATED' }, { rowNumber: 5, code: '', status: 'FAILED' }] });
  render(<MaterialMasterImport onImported={vi.fn()} />); upload();
  await screen.findByText('合法后续');
  expect(screen.getByText('编码需文本；该行将交由服务器校验。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '导入物料' }));
  await screen.findByText('新增 2，重复跳过 0，失败 2');
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/material-masters/import', expect.objectContaining({ body: JSON.stringify({ rows: [{ rowNumber: 2, materialCode: 'GOOD', materialName: '合法' }, { rowNumber: 3, materialCode: 'BAD', materialName: '' }, { rowNumber: 4, materialCode: 'BAD', materialName: '合法后续' }, { rowNumber: 5, materialCode: '', materialName: '数字编码' }] }) }));
});

it('retains the edit draft when explicit version reload fails over the network', async () => {
  render(<MaterialMasterPage organizationPermissions={permissions} />);
  await screen.findByText('原物料'); fireEvent.click(screen.getByRole('button', { name: /改\s*名/ }));
  fireEvent.change(screen.getByLabelText('编辑物料名称'), { target: { value: '网络失败仍保留' } });
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: '重新加载物料版本' }));
  await waitFor(() => expect(screen.getByLabelText('编辑物料名称')).not.toBeDisabled());
  expect(screen.getByLabelText('编辑物料名称')).toHaveValue('网络失败仍保留');
});

it('guards organization changes while a closed import modal retains unsubmitted rows', async () => {
  vi.mocked(apiRequest).mockResolvedValue([material]);
  const organizations = ['a', 'b'].map((id) => ({ id: `org-${id}`, code: id, name: `组织${id}`, type: 'INTERNAL' as const, permissions }));
  render(<MemoryRouter initialEntries={['/app/admin']}><LanguageProvider><UnsavedChangesProvider><AdminPage organizations={organizations} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await screen.findByText('原物料');
  upload(); await screen.findByText('中文物料');
  const closeImport = async () => {
    fireEvent.click(within(screen.getByRole('region', { name: '物料批量新增' })).getByRole('button', { name: /关\s*闭/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  };
  await closeImport();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '管理组织' }));
  fireEvent.click(screen.getByText('组织b · b', { selector: '.ant-select-item-option-content' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/material-masters?organizationId=org-b');
  fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  expect(screen.getByText('中文物料')).toBeInTheDocument();
  await closeImport();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '管理组织' }));
  fireEvent.click(screen.getByText('组织b · b', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/material-masters?organizationId=org-b'));
  fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  expect(screen.getByRole('button', { name: '导入物料' })).toBeDisabled();
  expect(screen.queryByText('中文物料')).not.toBeInTheDocument();
}, 60_000);

it('previews and reports added, skipped, failed rows with row numbers', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ created: 1, skipped: 1, failed: 1, items: [{ rowNumber: 2, code: '00042', status: 'CREATED' }, { rowNumber: 3, code: '00042', status: 'SKIPPED_DUPLICATE' }, { rowNumber: 4, code: 'BAD', status: 'FAILED' }] });
  render(<MaterialMasterImport onImported={vi.fn()} />); upload(); await screen.findByText('中文物料');
  fireEvent.click(screen.getByRole('button', { name: '导入物料' }));
  await screen.findByText('新增 1，重复跳过 1，失败 1');
  expect(screen.getByText('新增成功')).toBeInTheDocument(); expect(screen.getByText('重复跳过')).toBeInTheDocument(); expect(screen.getByText('失败')).toBeInTheDocument();
});

it('guards double clicks and replays the original import key after an unknown network result', async () => {
  let reject!: (reason: Error) => void;
  const response = new Promise((_, fail) => { reject = fail; });
  vi.mocked(apiRequest).mockReturnValueOnce(response).mockResolvedValueOnce({ created: 1, skipped: 0, failed: 0, items: [] });
  render(<MaterialMasterImport onImported={vi.fn()} />); upload(); await screen.findByText('中文物料');
  const submit = screen.getByRole('button', { name: '导入物料' }); fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  await act(async () => { reject(new Error('network')); await response.catch(() => undefined); });
  await waitFor(() => expect(submit).not.toBeDisabled()); fireEvent.click(submit);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(apiRequest).mock.calls[0]?.[1]?.headers).toEqual(vi.mocked(apiRequest).mock.calls[1]?.[1]?.headers);
});

it('clears import preview and discards late parsing on organization switch', async () => {
  let resolve!: (sheet: unknown[][]) => void;
  vi.mocked(readXlsxFile).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = render(<MaterialMasterImport organizationId="org-a" onImported={vi.fn()} />); upload();
  view.rerender(<MaterialMasterImport organizationId="org-b" onImported={vi.fn()} />);
  await act(async () => { resolve([['物料编码', '物料名称'], ['OLD', '旧组织物料']]); });
  expect(screen.queryByText('旧组织物料')).not.toBeInTheDocument(); if (!screen.queryByLabelText('物料清单文件')) fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  expect(screen.getByRole('button', { name: '导入物料' })).toBeDisabled();
});

it('exports only the loaded organization list as two text columns without interpreting formula-looking names', async () => {
  vi.mocked(apiRequest).mockResolvedValue([{ ...material, materialName: '=1+1' }]);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  try {
    render(<MaterialMasterPage organizationId="org-a" organizationPermissions={['material-master:read']} />);
    await screen.findByText('=1+1');
    fireEvent.click(screen.getByRole('button', { name: '导出当前物料清单' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(spreadsheet.rows).toEqual([['物料编码', '物料名称'], ['00042', '=1+1']]);
    expect(spreadsheet.columns.every((column) => column.numFmt === '@')).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/material-masters?organizationId=org-a');
  } finally { click.mockRestore(); }
});
it('REQ0019 opens material creation and import separately according to permission', async () => {
  render(<MaterialMasterPage organizationPermissions={['material-master:import']} />);
  expect(screen.queryByLabelText('物料编码')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('物料清单文件')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增物料' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '批量导入物料' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('物料清单文件')).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});
