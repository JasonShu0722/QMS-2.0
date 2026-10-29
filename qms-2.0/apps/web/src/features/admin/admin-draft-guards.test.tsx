import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { RoleAdministration } from './RoleAdministration';
import { UserAdministration } from './UserAdministration';
import { readXlsxFile } from '../imports/read-xlsx';
import type { AdminOrganization, AdminRole, AdminUser } from './admin';

vi.mock('../imports/read-xlsx', () => ({ readXlsxFile: vi.fn() }));
const render = (children: ReactNode) => testingRender(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: 'Organization A', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create', 'account:users:update', 'account:roles:read', 'account:roles:update', 'account:roles:assign', 'organization:structure:read', 'organization:positions:assign'] };
const account: AdminUser = { securityVersion: 1, id: 'user-a', username: 'alice', fullName: 'Alice', phone: null, email: null, profileVersion: 1, emailVerifiedAt: null, accountType: 'INTERNAL', status: 'ACTIVE', organizationId: organization.id, organization: { id: organization.id, code: organization.code, name: organization.name }, mfaEnabled: false, createdAt: '', updatedAt: '' };
const role: AdminRole = { id: 'role-a', code: 'READER', name: 'Reader Role', organizationId: organization.id, mfaRequired: false, permissions: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
beforeEach(() => { localStorage.clear(); // rc-component uses one shared test-id in test mode; keep dialog and Select IDs distinct.
  vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each(['role', 'user'] as const)('retains the %s editor draft on cancelled close and discards only after shared confirmation', async (kind) => {
  const user = baseUserEvent.setup();
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    return json(path.includes('/permission-catalog') ? [] : path.includes('/roles?') ? [role] : [account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider>{kind === 'role' ? <RoleAdministration organization={organization} /> : <UserAdministration organization={organization} organizations={[organization]} />}</UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: kind === 'role' ? '编辑角色' : /^编\s*辑$/ }));
  const editor = screen.getByRole('dialog');
  const label = kind === 'role' ? '角色名称' : '姓名';
  fireEvent.change(within(editor).getByLabelText(label), { target: { value: 'Unsaved draft' } });
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(within(editor).getByLabelText(label)).toHaveValue('Unsaved draft');
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: kind === 'role' ? '编辑角色' : /^编\s*辑$/ }));
  expect(screen.getByLabelText(label)).toHaveValue(kind === 'role' ? role.name : account.fullName);
  expect(writes).toEqual([]);
}, 30000);

it('opens legacy user authorization as read-only and closes without a draft or write', async () => {
  const user = baseUserEvent.setup();
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    if (path.includes('/users/user-a/roles?')) return json({ roles: [role], effectiveRoles: [{ ...role, sources: [{ kind: 'DIRECT' }] }], permissions: [] });
    return json([account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={organization} organizations={[organization]} /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看授权来源' }));
  const editor = await screen.findByRole('dialog', { name: 'alice · 授权来源' });
  await waitFor(() => expect(within(editor).getByText(role.name)).toBeVisible());
  expect(within(editor).queryByRole('combobox')).not.toBeInTheDocument();
  expect(within(editor).queryByRole('button', { name: '保存角色分配' })).not.toBeInTheDocument();
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(writes).toEqual([]);
}, 30000);

it('keeps the batch account modal open while creation is pending and allows closing after settlement', async () => {
  const user = baseUserEvent.setup();
  vi.mocked(readXlsxFile).mockResolvedValue([['用户名', '邮箱', '账号类型', '岗位代码'], ['new.user', '', 'INTERNAL', 'QA']]);
  let finish!: (response: Response) => void;
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([{ id: 'd1', status: 'ACTIVE' }]);
    if (path.includes('/positions?')) return json([{ id: 'p1', departmentId: 'd1', code: 'QA', status: 'ACTIVE' }]);
    if (path.endsWith('/position-authorization/preview')) return json({ authorizationBaseline: 'baseline-1', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false });
    if (path === '/api/v1/admin/users/batch') { writes.push(init); return new Promise<Response>(resolve => { finish = resolve; }); }
    return json([account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={organization} organizations={[organization]} /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '批量创建账号' }));
  const editor = await screen.findByRole('dialog', { name: '批量创建账号' });
  const fileInput = within(editor).getByLabelText('账号清单文件');
  await waitFor(() => expect(fileInput).toBeVisible());
  await user.upload(fileInput, new File(['xlsx'], 'accounts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  await waitFor(() => expect(within(editor).getByRole('button', { name: '创建账号' })).toBeEnabled());
  await user.click(within(editor).getByRole('button', { name: '创建账号' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(within(editor).getByLabelText('账号清单文件')).toBeDisabled();
  const close = within(editor).queryByRole('button', { name: '关闭' });
  if (close) await user.click(close);
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(editor).toBeInTheDocument();
  expect(editor).toBeVisible();
  expect(screen.getByRole('dialog', { name: '批量创建账号' })).toBe(editor);
  await act(async () => finish(json({ batchId: 'batch-a', rows: [{ rowNumber: 2, username: 'new.user', status: 'SUCCESS', userId: 'new-user' }] })));
  expect(await within(editor).findByText('成功')).toBeVisible();
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(writes).toHaveLength(1);
}, 15000);
