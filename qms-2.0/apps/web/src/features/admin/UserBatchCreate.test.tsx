import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { parseUserBatchRows, UserBatchCreate } from './UserBatchCreate';
import { readXlsxFile } from '../imports/read-xlsx';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('maps the fixed account template preserving original row numbers', () => {
  expect(parseUserBatchRows([
    ['用户名', '邮箱', '账号类型'],
    ['alice', 'alice@example.test', 'INTERNAL'],
    ['', '', ''],
    ['bob', '', 'INTERNAL'],
  ])).toEqual([
    { rowNumber: 2, username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL' },
    { rowNumber: 4, username: 'bob', email: null, accountType: 'INTERNAL' },
  ]);
});

it('rejects supplier rows and formula-like cells before upload', () => {
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型'], ['=alice', '', 'INTERNAL']])).toThrow();
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型'], ['alice', '', 'SUPPLIER']])).toThrow();
});

it('retries unknown network results with the same batch key and prevents a second submission after success', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型'], ['alice', '', 'INTERNAL']]);
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
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型'], ['alice', '', 'INTERNAL']]);
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
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型'], ['alice', '', 'INTERNAL']]);
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
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型'], ['alice', '', 'INTERNAL']]);
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
