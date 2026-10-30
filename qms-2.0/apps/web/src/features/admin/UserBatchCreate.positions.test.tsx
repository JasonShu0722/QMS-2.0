import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { parseUserBatchRows, UserBatchCreate } from './UserBatchCreate';
import { readXlsxFile } from '../imports/read-xlsx';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('resolves an exact direct-position code and displays its nullable department in the batch preview', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'ADMIN']]);
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/positions?')) return json([{ id: 'direct', code: 'ADMIN', name: '组织管理员', status: 'ACTIVE', departmentId: null }]);
    if (path.includes('/departments?')) return json([]);
    if (path.endsWith('/position-authorization/preview')) return json({ authorizationBaseline: 'direct-baseline', positions: [{ id: 'direct', name: '组织管理员', code: 'ADMIN', department: null, historicalSources: [] }], effectivePermissionCodes: [], effectiveMfaRequired: false });
    if (path === '/api/v1/admin/users/batch') { writes.push(JSON.parse(String(init?.body))); return json({ batchId: 'b', rows: [] }); }
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'direct.xlsx')] } });
  expect(await screen.findByText('组织直属 · 组织管理员 (ADMIN)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ rows: [{ positionIds: ['direct'], authorizationBaseline: 'direct-baseline' }] });
});

it('requires the new four-column position-code template instead of silently accepting old unassigned accounts', () => {
  expect(() => parseUserBatchRows([['用户名', '邮箱', '账号类型'], ['alice', '', 'INTERNAL']])).toThrow('请使用包含岗位代码的新版模板');
});

it('preserves missing, duplicate and excessive position codes for row-level validation with original row numbers', () => {
  const header = ['用户名', '邮箱', '账号类型', '岗位代码'];
  const excessive = Array.from({ length: 101 }, (_, index) => `P${index}`);
  expect(parseUserBatchRows([header, ['empty', '', 'INTERNAL', ''], ['duplicate', '', 'INTERNAL', 'QA;QA'], ['excessive', '', 'INTERNAL', excessive.join(';')]])).toEqual([
    { rowNumber: 2, username: 'empty', email: null, accountType: 'INTERNAL', positionCodes: [''] },
    { rowNumber: 3, username: 'duplicate', email: null, accountType: 'INTERNAL', positionCodes: ['QA', 'QA'] },
    { rowNumber: 4, username: 'excessive', email: null, accountType: 'INTERNAL', positionCodes: excessive },
  ]);
});

it('keeps exact semicolon-separated position codes and original row numbers for authorization preparation', () => {
  expect(parseUserBatchRows([
    ['用户名', '邮箱', '账号类型', '岗位代码'],
    ['alice', '', 'INTERNAL', 'QA;QE'],
    ['', '', '', ''],
    ['bob', 'bob@example.test', 'INTERNAL', 'Quality.Engineer'],
  ])).toEqual([
    { rowNumber: 2, username: 'alice', email: null, accountType: 'INTERNAL', positionCodes: ['QA', 'QE'] },
    { rowNumber: 4, username: 'bob', email: 'bob@example.test', accountType: 'INTERNAL', positionCodes: ['Quality.Engineer'] },
  ]);
});

it('resolves exact position codes and reuses one preview per combination without changing an unknown-result retry', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA'], ['bob', '', 'INTERNAL', 'QA']]);
  const writes: { key: string; body: string }[] = [];
  let previews = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/positions?')) return json([{ id: 'p1', code: 'QA', name: 'Quality', status: 'ACTIVE', departmentId: 'd1' }]);
    if (path.includes('/departments?')) return json([{ id: 'd1', code: 'Q', name: 'Quality', status: 'ACTIVE' }]);
    if (path.endsWith('/position-authorization/preview')) { previews++; return json({ authorizationBaseline: 'baseline-1', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false }); }
    if (path === '/api/v1/admin/users/batch') {
      writes.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key'], body: String(init?.body) });
      if (writes.length === 1) throw new TypeError('unknown network result');
      return json({ batchId: 'b1', rows: [{ rowNumber: 2, username: 'alice', status: 'SUCCESS' }, { rowNumber: 3, username: 'bob', status: 'ERROR', code: 'ADMIN_USER_DUPLICATE' }] });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'accounts.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await screen.findByText('请求失败，请重试');
  expect(screen.getByLabelText('账号清单文件')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await screen.findByText('成功');
  expect(previews).toBe(1);
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[0]!.body).rows).toEqual([
    { rowNumber: 2, username: 'alice', email: null, accountType: 'INTERNAL', positionIds: ['p1'], authorizationBaseline: 'baseline-1' },
    { rowNumber: 3, username: 'bob', email: null, accountType: 'INTERNAL', positionIds: ['p1'], authorizationBaseline: 'baseline-1' },
  ]);
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
});

it('never guesses a position by its name or case-insensitive code', async () => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'quality']]);
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.includes('/positions?')) return json([{ id: 'p1', code: 'QUALITY', name: 'quality', status: 'ACTIVE', departmentId: 'd1' }]);
    if (path.includes('/departments?')) return json([{ id: 'd1', status: 'ACTIVE' }]);
    writes++;
    return json([]);
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'accounts.xlsx')] } });
  expect(await screen.findByText(/岗位代码不存在或不可用/)).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  expect(writes).toBe(0);
});

it('preserves valid, unknown, disabled, ceiling-denied and valid rows for one authoritative server batch result', async () => {
  const allowed = '10000000-0000-4000-8000-000000000001';
  const denied = '10000000-0000-4000-8000-000000000002';
  vi.mocked(readXlsxFile).mockResolvedValue([
    ['用户名', '邮箱', '账号类型', '岗位代码'],
    ['alice', '', 'INTERNAL', 'QA'],
    ['wrong', '', 'INTERNAL', 'MISSING'],
    ['stopped', '', 'INTERNAL', 'STOP'],
    ['ceiling', '', 'INTERNAL', 'QE'],
    ['', '', '', ''],
    ['bob', '', 'INTERNAL', 'QA'],
  ]);
  const previewIds: string[][] = [];
  let written: unknown;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([{ id: 'd1', status: 'ACTIVE' }]);
    if (path.includes('/positions?')) return json([
      { id: allowed, code: 'QA', departmentId: 'd1', status: 'ACTIVE' },
      { id: denied, code: 'QE', departmentId: 'd1', status: 'ACTIVE' },
      { id: '10000000-0000-4000-8000-000000000003', code: 'STOP', departmentId: 'd1', status: 'DISABLED' },
    ]);
    if (path.endsWith('/position-authorization/preview')) {
      const ids = JSON.parse(String(init?.body)).positionIds as string[];
      previewIds.push(ids);
      if (ids.includes(denied)) return json({ code: 'POSITION_GRANT_CEILING_DENIED', message: 'private ceiling detail' }, 403);
      return json({ authorizationBaseline: 'signed-allowed-baseline', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false });
    }
    if (path === '/api/v1/admin/users/batch') {
      written = JSON.parse(String(init?.body));
      return json({ batchId: 'server-batch', rows: [
        { rowNumber: 2, username: 'alice', status: 'SUCCESS' },
        { rowNumber: 3, username: 'wrong', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 4, username: 'stopped', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 5, username: 'ceiling', status: 'ERROR', code: 'FEATURE_PERMISSION_DENIED' },
        { rowNumber: 7, username: 'bob', status: 'SUCCESS' },
      ] });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'mixed.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  expect(screen.queryByText('成功')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await waitFor(() => expect(screen.getAllByText('成功')).toHaveLength(2));
  expect(screen.getAllByText('失败 · ADMIN_BATCH_ROW_INVALID')).toHaveLength(2);
  expect(screen.getByText('失败 · FEATURE_PERMISSION_DENIED')).toBeVisible();
  expect(screen.getByText(/岗位代码不存在或不可用.*MISSING/)).toBeVisible();
  expect(screen.getByText(/岗位代码不存在或不可用.*STOP/)).toBeVisible();
  expect(screen.queryByText('private ceiling detail')).not.toBeInTheDocument();
  expect(previewIds).toEqual([[allowed], [denied]]);
  expect(written).toEqual({ organizationId: 'org', rows: [
    { rowNumber: 2, username: 'alice', email: null, accountType: 'INTERNAL', positionIds: [allowed], authorizationBaseline: 'signed-allowed-baseline' },
    { rowNumber: 3, username: 'wrong', email: null, accountType: 'INTERNAL', positionIds: [], authorizationBaseline: expect.any(String) },
    { rowNumber: 4, username: 'stopped', email: null, accountType: 'INTERNAL', positionIds: [], authorizationBaseline: expect.any(String) },
    { rowNumber: 5, username: 'ceiling', email: null, accountType: 'INTERNAL', positionIds: [denied], authorizationBaseline: expect.not.stringMatching(/^signed-/) },
    { rowNumber: 7, username: 'bob', email: null, accountType: 'INTERNAL', positionIds: [allowed], authorizationBaseline: 'signed-allowed-baseline' },
  ] });
});

it('keeps valid, empty, duplicate, excessive and valid position-code rows without granting a partial position set', async () => {
  const excessive = Array.from({ length: 101 }, (_, index) => `P${index}`);
  vi.mocked(readXlsxFile).mockResolvedValue([
    ['用户名', '邮箱', '账号类型', '岗位代码'],
    ['alice', '', 'INTERNAL', 'QA'],
    ['empty', '', 'INTERNAL', ''],
    ['duplicate', '', 'INTERNAL', 'QA;QA'],
    ['excessive', '', 'INTERNAL', excessive.join(';')],
    ['bob', '', 'INTERNAL', 'QA'],
  ]);
  let written: unknown;
  const previewIds: string[][] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([{ id: 'd1', status: 'ACTIVE' }]);
    if (path.includes('/positions?')) {
      const offset = Number(new URL(path, 'https://example.test').searchParams.get('offset'));
      return json([{ id: 'qa', code: 'QA', departmentId: 'd1', status: 'ACTIVE' }, ...excessive.map(code => ({ id: code, code, departmentId: 'd1', status: 'ACTIVE' }))].slice(offset, offset + 100));
    }
    if (path.endsWith('/position-authorization/preview')) {
      previewIds.push(JSON.parse(String(init?.body)).positionIds as string[]);
      return json({ authorizationBaseline: 'signed-valid-baseline', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false });
    }
    if (path === '/api/v1/admin/users/batch') {
      written = JSON.parse(String(init?.body));
      return json({ batchId: 'server-batch', rows: [
        { rowNumber: 2, username: 'alice', status: 'SUCCESS' },
        { rowNumber: 3, username: 'empty', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 4, username: 'duplicate', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 5, username: 'excessive', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' },
        { rowNumber: 6, username: 'bob', status: 'SUCCESS' },
      ] });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'mixed-invalid.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await waitFor(() => expect(screen.getAllByText('成功')).toHaveLength(2));
  expect(screen.getAllByText('失败 · ADMIN_BATCH_ROW_INVALID')).toHaveLength(3);
  expect(screen.getAllByText(/本地预检.*每行必须填写 1–100 个不重复的岗位代码/)).toHaveLength(3);
  expect(previewIds).toEqual([['qa']]);
  expect(written).toEqual({ organizationId: 'org', rows: [
    { rowNumber: 2, username: 'alice', email: null, accountType: 'INTERNAL', positionIds: ['qa'], authorizationBaseline: 'signed-valid-baseline' },
    { rowNumber: 3, username: 'empty', email: null, accountType: 'INTERNAL', positionIds: [], authorizationBaseline: expect.not.stringMatching(/^signed-/) },
    { rowNumber: 4, username: 'duplicate', email: null, accountType: 'INTERNAL', positionIds: [], authorizationBaseline: expect.not.stringMatching(/^signed-/) },
    { rowNumber: 5, username: 'excessive', email: null, accountType: 'INTERNAL', positionIds: [], authorizationBaseline: expect.not.stringMatching(/^signed-/) },
    { rowNumber: 6, username: 'bob', email: null, accountType: 'INTERNAL', positionIds: ['qa'], authorizationBaseline: 'signed-valid-baseline' },
  ] });
});

it.each([
  { status: 401, code: 'AUTH_SESSION_REQUIRED' },
  { status: 403, code: 'FEATURE_PERMISSION_DENIED' },
  { status: 403, code: 'ORGANIZATION_DISABLED' },
  { status: 0, code: 'network' },
])('stops all writes and later previews for non-ceiling failure $status/$code', async ({ status, code }) => {
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['alice', '', 'INTERNAL', 'QA'], ['blocked', '', 'INTERNAL', 'QE'], ['bob', '', 'INTERNAL', 'QC']]);
  const previewIds: string[][] = [];
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([{ id: 'd1', status: 'ACTIVE' }]);
    if (path.includes('/positions?')) return json(['QA', 'QE', 'QC'].map((value, index) => ({ id: `p${index}`, code: value, departmentId: 'd1', status: 'ACTIVE' })));
    if (path.endsWith('/position-authorization/preview')) {
      const ids = JSON.parse(String(init?.body)).positionIds as string[];
      previewIds.push(ids);
      if (ids.includes('p1')) {
        if (!status) throw new TypeError('network unavailable');
        return json({ code, message: 'private auth failure' }, status);
      }
      return json({ authorizationBaseline: 'signed-baseline', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false });
    }
    writes++;
    return json({ batchId: 'must-not-exist', rows: [] });
  }));
  render(<UserBatchCreate organizationId="org" />);
  fireEvent.change(screen.getByLabelText('账号清单文件'), { target: { files: [new File(['xlsx'], 'blocked.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '重新预览授权' })).toBeEnabled());
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
  expect(screen.queryByText('成功')).not.toBeInTheDocument();
  expect(screen.queryByText('private auth failure')).not.toBeInTheDocument();
  expect(previewIds).toEqual([['p0'], ['p1']]);
  expect(writes).toBe(0);
});
