import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExcelJS from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { readXlsxFile } from '../imports/read-xlsx';
import { UserBatchCreate } from './UserBatchCreate';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));

const header = ['用户名', '姓名', '账号类型', '主组织', '密码'];
const password = '  +Private!Password42  ';
const validRow = ['alice', '张三', 'INTERNAL', 'PLANT', password];
const previewPath = '/api/v1/admin/users/batch/preview';
const confirmPath = '/api/v1/admin/users/batch/confirm';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const preview = (rows: unknown[]) => json({ previewId: 'preview-a', expiresAt: '2099-01-01T00:00:00Z', rows });
const ready = { rowNumber: 2, status: 'READY', organizationName: '一号工厂' };

function upload(rows: unknown[][]) {
  vi.mocked(readXlsxFile).mockResolvedValue(rows);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'accounts.xlsx')] } });
}

function confirmButton() { return screen.getByRole('button', { name: '创建账号' }); }

function mockRequests(route: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : route(path, init));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function captureWorkbook() {
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:batch-workbook');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return async () => {
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    const [blob] = createObjectURL.mock.calls[0]!;
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    return workbook.worksheets[0]!;
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('downloads the five-column template and prompts for replacement of the old template', async () => {
  const workbook = captureWorkbook();
  const fetcher = mockRequests(() => { throw new Error('unexpected request'); });
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.click(screen.getByRole('button', { name: '下载账号模板' }));
  expect((await workbook()).getRow(1).values).toEqual([, ...header]);
  upload([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA']]);
  expect(await screen.findByText('请下载并使用新版五列账号模板')).toBeVisible();
  expect(confirmButton()).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('previews authorized organizations across account types and confirms only the server preview', async () => {
  const fetcher = mockRequests((path) => path === previewPath ? preview([
    ready,
    { rowNumber: 4, status: 'READY', organizationName: '乙供应商' },
    { rowNumber: 6, status: 'SKIPPED', code: 'ORGANIZATION_SCOPE_DENIED', message: password },
    { rowNumber: 7, status: 'READY', organizationName: '二号工厂' },
  ]) : json({ batchId: 'batch', rows: [
    { rowNumber: 2, status: 'SUCCESS', username: password, configurationRequired: true, temporaryPassword: { temporaryPassword: password } },
    { rowNumber: 4, status: 'SKIPPED', code: 'FEATURE_PERMISSION_DENIED' },
    { rowNumber: 7, status: 'FAILED', code: password, message: password },
  ] }));
  const workbook = captureWorkbook();
  userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  const { container } = render(<UserBatchCreate organizationId="org-a" canAuthorize={false} />);
  upload([
    header, validRow, [], ['vendor', '李四', '供应商账号', 'VENDOR', password],
    ['empty-org', '王五', 'INTERNAL', '', password], ['denied', '周六', 'INTERNAL', 'OUTSIDE', password],
    ['bob', '赵七', 'INTERNAL', 'SECOND', password],
  ]);
  expect(await screen.findByText('一号工厂')).toBeVisible();
  expect(screen.getByText('乙供应商')).toBeVisible();
  expect(screen.getByText('二号工厂')).toBeVisible();
  expect(screen.getByText('请填写主组织代码')).toBeVisible();
  expect(screen.getByText('无权访问该组织')).toBeVisible();
  expect(screen.getAllByText('可创建')).toHaveLength(3);
  expect(container.textContent).not.toContain(password.trim());
  const previewInit = fetcher.mock.calls.find(([path]) => path === previewPath)?.[1];
  expect(JSON.parse(String(previewInit?.body))).toEqual({ organizationId: 'org-a', rows: [
    { rowNumber: 2, username: 'alice', fullName: '张三', accountType: 'INTERNAL', organizationCode: 'PLANT', password },
    { rowNumber: 4, username: 'vendor', fullName: '李四', accountType: 'SUPPLIER', organizationCode: 'VENDOR', password },
    { rowNumber: 6, username: 'denied', fullName: '周六', accountType: 'INTERNAL', organizationCode: 'OUTSIDE', password },
    { rowNumber: 7, username: 'bob', fullName: '赵七', accountType: 'INTERNAL', organizationCode: 'SECOND', password },
  ] });
  expect(fetcher.mock.calls.some(([path]) => path === confirmPath)).toBe(false);
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  fireEvent.click(confirmButton());
  expect(await screen.findByText('成功')).toBeVisible();
  expect(screen.getByText('待配置')).toBeVisible();
  expect(screen.getAllByText('跳过')).toHaveLength(3);
  expect(screen.getByText('失败')).toBeVisible();
  expect(confirmButton()).toBeDisabled();
  expect(container.textContent).not.toContain(password.trim());
  expect(JSON.parse(String(fetcher.mock.calls.find(([path]) => path === confirmPath)?.[1]?.body))).toEqual({ organizationId: 'org-a', previewId: 'preview-a' });
  expect(screen.queryByRole('button', { name: /临时密码/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '复制账号' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('alice'));
  await waitFor(() => expect(screen.getByRole('button', { name: '下载账号清单' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下载账号清单' }));
  const sheet = await workbook();
  expect(JSON.stringify(sheet.getSheetValues())).not.toContain(password.trim());
  expect(sheet.getColumn(1).values?.slice(2)).toEqual([2, 4, 5, 6, 7]);
});

it('retries an unknown confirmation with the same key and keeps the file locked until it settles', async () => {
  let attempts = 0;
  const fetcher = mockRequests((path) => {
    if (path === previewPath) return preview([ready]);
    if (++attempts === 1) throw new TypeError(password);
    return json({ batchId: 'batch', rows: [{ rowNumber: 2, status: 'SUCCESS' }] });
  });
  render(<UserBatchCreate organizationId="org-a" />);
  upload([header, validRow]);
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  fireEvent.click(confirmButton());
  expect(await screen.findByText('请求失败，请重试')).toBeVisible();
  expect(screen.getByLabelText('账号清单文件')).toBeDisabled();
  fireEvent.click(confirmButton());
  expect(await screen.findByText('成功')).toBeVisible();
  const confirms = fetcher.mock.calls.filter(([path]) => path === confirmPath);
  expect(confirms).toHaveLength(2);
  expect(confirms[0]?.[1]).toMatchObject({ headers: { 'Idempotency-Key': expect.any(String), 'x-csrf-token': 'csrf' } });
  expect(JSON.parse(String(confirms[0]?.[1]?.body))).toEqual({ organizationId: 'org-a', previewId: 'preview-a' });
  expect(confirms[0]?.[1]?.headers).toEqual(confirms[1]?.[1]?.headers);
  expect(screen.getByLabelText('账号清单文件')).toBeEnabled();
});

it('unlocks the file when the server rejects an expired preview', async () => {
  mockRequests(path => path === previewPath ? preview([ready]) : json({ code: 'ADMIN_BATCH_ROW_INVALID', message: password }, 409));
  render(<UserBatchCreate organizationId="org-a" />);
  upload([header, validRow]);
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  fireEvent.click(confirmButton());
  expect(await screen.findByText('批量建号预览已失效，请重新导入')).toBeVisible();
  expect(confirmButton()).toBeDisabled();
  expect(screen.getByLabelText('账号清单文件')).toBeEnabled();
});

it('retries the same preview with its original key after a network interruption', async () => {
  let attempts = 0;
  const fetcher = mockRequests(() => {
    if (++attempts === 1) throw new TypeError(password);
    return preview([ready]);
  });
  render(<UserBatchCreate organizationId="org-a" />);
  upload([header, validRow]);
  const retry = await screen.findByRole('button', { name: '重试预览' });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  const attemptsForPreview = fetcher.mock.calls.filter(([path]) => path === previewPath);
  expect(attemptsForPreview).toHaveLength(2);
  expect(attemptsForPreview[0]?.[1]?.headers).toEqual(attemptsForPreview[1]?.[1]?.headers);
  expect(attemptsForPreview[0]?.[1]?.body).toEqual(attemptsForPreview[1]?.[1]?.body);
});

it('drops late previews when the management organization changes', async () => {
  let finish!: (response: Response) => void;
  const fetcher = mockRequests(() => new Promise<Response>(resolve => { finish = resolve; }));
  const { rerender } = render(<UserBatchCreate organizationId="org-a" />);
  upload([header, validRow]);
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path === previewPath)).toBe(true));
  rerender(<UserBatchCreate organizationId="org-b" />);
  await act(async () => finish(preview([ready])));
  expect(screen.queryByText('一号工厂')).not.toBeInTheDocument();
  expect(confirmButton()).toBeDisabled();
});

it('replaces raw parse and preview errors with controlled messages', async () => {
  mockRequests(() => json({ code: 'VALIDATION_FAILED', message: password, fields: { password: [password] } }, 400));
  const { container } = render(<UserBatchCreate organizationId="org-a" />);
  upload([header, validRow]);
  expect(await screen.findByText('请检查填写内容')).toBeVisible();
  expect(confirmButton()).toBeDisabled();
  expect(container.textContent).not.toContain(password.trim());
  vi.mocked(readXlsxFile).mockRejectedValueOnce(new Error(password));
  upload([header, validRow]);
  expect(await within(container).findByText('Excel 文件无法解析，请检查文件格式')).toBeVisible();
  expect(container.textContent).not.toContain(password.trim());
});
