import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserBatchCreate } from './UserBatchCreate';
import { readXlsxFile } from '../imports/read-xlsx';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));

const header = ['用户名', '姓名', '账号类型', '主组织', '密码'];
const password = 'Example!Password42';
const previewPath = '/api/v1/admin/users/batch/preview';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

function upload(rows: unknown[][]) {
  vi.mocked(readXlsxFile).mockResolvedValue([header, ...rows]);
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'accounts.xlsx')] } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('shows exact-code, type-mismatch and duplicate issues without enabling an all-skipped preview', async () => {
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path !== previewPath) throw new Error(`Unexpected request: ${path}`);
    return json({ previewId: 'preview', expiresAt: '2099-01-01T00:00:00Z', rows: [
      { rowNumber: 2, status: 'SKIPPED', code: 'ORGANIZATION_NOT_FOUND', organizationName: '私有组织', message: password },
      { rowNumber: 3, status: 'SKIPPED', code: 'ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', organizationName: '一号工厂' },
      { rowNumber: 5, status: 'SKIPPED', code: 'ADMIN_USER_DUPLICATE' },
    ] });
  });
  vi.stubGlobal('fetch', fetcher);
  upload([['wrong-case', '甲', 'INTERNAL', 'plant', password], ['mismatch', '乙', 'SUPPLIER', 'PLANT', password], [], ['duplicate', '丙', 'INTERNAL', 'PLANT', password]]);
  expect(await screen.findByText('主组织代码无法识别或无权管理')).toBeVisible();
  expect(screen.getByText('账号类型与主组织类型不一致')).toBeVisible();
  expect(screen.getByText('用户名已存在')).toBeVisible();
  expect(screen.queryByText('私有组织')).not.toBeInTheDocument();
  expect(screen.queryByText(password)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/v1/auth/csrf', previewPath]);
});

it('keeps original spreadsheet row numbers and skips malformed rows without sending passwords', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  upload([
    ['', '', '', '', password],
    [],
    ['formula', { formula: 'A1', result: password }, 'INTERNAL', 'PLANT', password],
    ['extra', '甲', 'INTERNAL', 'PLANT', password, 'unexpected'],
    ['missing', '乙', 'INTERNAL', 'PLANT'],
    ['short', '丙', 'INTERNAL', 'PLANT', 'short'],
  ]);
  expect(await screen.findByText('请填写用户名')).toBeVisible();
  expect(screen.getByText('请填写姓名')).toBeVisible();
  expect(screen.getByText('请填写账号类型')).toBeVisible();
  expect(screen.getByText('请填写主组织代码')).toBeVisible();
  expect(screen.getAllByText('不支持公式、对象或额外数据列')).toHaveLength(2);
  expect(screen.getByText('请填写密码')).toBeVisible();
  expect(screen.getByText('密码须为 12–256 个字符')).toBeVisible();
  expect(screen.getByRole('cell', { name: '4' })).toBeVisible();
  expect(screen.queryByRole('cell', { name: '3' })).not.toBeInTheDocument();
  expect(screen.queryByText(password)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('账号清单文件')).toBeEnabled());
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});
