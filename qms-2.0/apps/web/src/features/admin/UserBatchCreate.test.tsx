import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { parseUserBatchRows, UserBatchCreate } from './UserBatchCreate';
import { readXlsxFile } from '../imports/read-xlsx';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('./position-authorization', () => ({
  loadPositionDirectory: async () => ({ departments: [{ id: 'd1', status: 'ACTIVE' }], positions: [{ id: 'p1', departmentId: 'd1', code: 'QA', status: 'ACTIVE' }] }),
  previewPositions: async () => ({ authorizationBaseline: 'baseline-1', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false }),
}));
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('maps the fixed account template preserving original row numbers', () => {
  expect(parseUserBatchRows([
    ['用户名', '邮箱', '账号类型', '岗位代码'],
    ['alice', 'alice@example.test', 'INTERNAL', 'QA'],
    ['', '', ''],
    ['bob', '', 'INTERNAL', 'QA'],
  ])).toEqual([
    { rowNumber: 2, username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', positionCodes: ['QA'] },
    { rowNumber: 4, username: 'bob', email: null, accountType: 'INTERNAL', positionCodes: ['QA'] },
  ]);
});

it('rejects unsafe formula structures and extra data columns before upload', () => {
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型', '岗位代码'], ['=alice', '', 'INTERNAL', 'QA']])).toThrow();
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型', '岗位代码'], [{ formula: '1+1', result: 'alice' }, '', 'INTERNAL', 'QA']])).toThrow();
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA', 'extra']])).toThrow();
});

it('preserves unsupported account types and invalid business values for per-row server validation', () => {
  expect(parseUserBatchRows([['用户名', '邮箱', '账号类型', '岗位代码'], ['bad user', 'invalid-email', 'SUPPLIER', 'QA'], ['', 'wrong', 'UNKNOWN', 'QA']])).toEqual([
    { rowNumber: 2, username: 'bad user', email: 'invalid-email', accountType: 'SUPPLIER', positionCodes: ['QA'] },
    { rowNumber: 3, username: '', email: 'wrong', accountType: 'UNKNOWN', positionCodes: ['QA'] },
  ]);
});

it('submits mixed valid duplicate and invalid business rows and displays server partial-success results', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA'], ['alice', '', 'INTERNAL', 'QA'], ['bad user', 'invalid-email', 'UNKNOWN', 'QA']]);
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : json({ batchId: 'batch', rows: [
    { rowNumber: 2, username: 'alice', status: 'SUCCESS' },
    { rowNumber: 3, username: 'alice', status: 'ERROR', code: 'ADMIN_USER_DUPLICATE' },
    { rowNumber: 4, username: 'bad user', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
  ] }));
  vi.stubGlobal('fetch', fetcher);
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['content'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  expect(await screen.findByText('成功')).toBeInTheDocument();
  expect(screen.getByText('失败 · ADMIN_USER_DUPLICATE')).toBeInTheDocument();
  expect(screen.getByText('失败 · ADMIN_BATCH_ROW_INVALID')).toBeInTheDocument();
  const call = fetcher.mock.calls.find(([path]) => path === '/api/v1/admin/users/batch');
  expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string).rows[2]).toEqual({ rowNumber: 4, username: 'bad user', email: 'invalid-email', accountType: 'UNKNOWN', positionIds: ['p1'], authorizationBaseline: 'baseline-1' });
});

it('retries unknown network results with the same batch key and prevents a second submission after success', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA']]);
  const keys: string[] = [];
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    keys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
    if (keys.length === 1) throw new TypeError('network lost');
    return json({ batchId: 'batch', rows: [{ rowNumber: 2, username: 'alice', status: 'SUCCESS', userId: 'u', temporaryPassword: { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'temporary-only-in-memory' } }] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['content'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  expect(await screen.findByText('temporary-only-in-memory')).toBeInTheDocument();
  expect(keys[1]).toBe(keys[0]);
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
});

it('drops secrets on an organization change and does not expose a late response', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA']]);
  let resolve: ((value: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : new Promise<Response>((done) => { resolve = done; })));
  const view = render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['content'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(<UserBatchCreate organizationId="org-b" />);
  resolve!(json({ batchId: 'batch', rows: [{ rowNumber: 2, username: 'alice', status: 'SUCCESS', temporaryPassword: { status: 'AVAILABLE', temporaryPassword: 'stale-secret' } }] }));
  await waitFor(() => expect(screen.queryByText('stale-secret')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
});

it('revalidates the temporary password before every copy and clears an expired secret', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA']]);
  let reads = 0;
  const clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/temporary-password/read')) {
      reads++;
      return json(reads === 1 ? { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'fresh-password' } : { userId: 'u', status: 'EXPIRED' });
    }
    return json({ batchId: 'batch', rows: [{ rowNumber: 2, username: 'alice', status: 'SUCCESS', userId: 'u', temporaryPassword: { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'old-password' } }] });
  }));
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['content'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await userEvent.click(await screen.findByRole('button', { name: '复制临时密码' }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('fresh-password'));
  await userEvent.click(screen.getByRole('button', { name: '复制临时密码' }));
  expect(await screen.findByText('已过期')).toBeInTheDocument();
  expect(screen.queryByText('fresh-password')).not.toBeInTheDocument();
  expect(clipboard).toHaveBeenCalledTimes(1);
  expect(reads).toBe(2);
});

it('removes previously displayed secrets if the protected copy loses permission', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA']]);
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : path.includes('/temporary-password/read')
    ? new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED' }), { status: 403, headers: { 'content-type': 'application/json' } })
    : json({ batchId: 'batch', rows: [{ rowNumber: 2, username: 'alice', status: 'SUCCESS', userId: 'u', temporaryPassword: { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'secret-before-revocation' } }] })));
  render(<UserBatchCreate organizationId="org-a" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['content'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await userEvent.click(await screen.findByRole('button', { name: '复制临时密码' }));
  expect(await screen.findByText('无权执行此操作')).toBeInTheDocument();
  expect(screen.queryByText('secret-before-revocation')).not.toBeInTheDocument();
});
