import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { components } from '@qms/contracts';
import type { ReactNode } from 'react';
import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { RoleAdministration } from './RoleAdministration';
import { UserAdministration } from './UserAdministration';
import { openUserManagement } from './user-management-test-helpers';
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
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    return json(path.includes('/permission-catalog') ? [] : path.includes('/roles?') ? [role] : [account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider>{kind === 'role' ? <RoleAdministration organization={organization} /> : <UserAdministration organization={organization} organizations={[organization]} />}</UnsavedChangesProvider></MemoryRouter>);
  const action = kind === 'role' ? '编辑角色' : '管理用户';
  const openEditor = () => screen.findByText(action, { selector: 'button > span' }).then(label => fireEvent.click(label.closest('button')!));
  await openEditor();
  const editor = await screen.findByRole('dialog');
  const label = kind === 'role' ? '角色名称' : '姓名';
  fireEvent.change(within(editor).getByLabelText(label), { target: { value: 'Unsaved draft' } });
  fireEvent.click(within(editor).getByRole('button', { name: '关闭' }));
  const confirmationTitle = '当前草稿尚未保存，继续将放弃修改。';
  const confirmation = () => screen.findByLabelText(confirmationTitle, { selector: '[role="dialog"]' });
  fireEvent.click(within(await confirmation()).getByText('继续编辑', { selector: 'button > span' }).closest('button')!);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: confirmationTitle })).not.toBeInTheDocument());
  expect(within(editor).getByLabelText(label)).toHaveValue('Unsaved draft');
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  fireEvent.click(within(await confirmation()).getByText(/^放弃修改(?:并关闭)?$/, { selector: 'button > span' }).closest('button')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await openEditor();
  expect(screen.getByLabelText(label, { selector: 'input' })).toHaveValue(kind === 'role' ? role.name : account.fullName);
  expect(writes).toEqual([]);
}, 30000);

it('opens legacy user authorization as read-only and closes without a draft or write', async () => {
  const user = baseUserEvent.setup();
  const writes: RequestInit[] = [];
  const limitedOrganization = { ...organization, permissions: organization.permissions.filter(code => code !== 'organization:structure:read') };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    if (path.includes('/users/user-a/roles?')) return json({ roles: [role], effectiveRoles: [{ ...role, sources: [{ kind: 'DIRECT' }] }], permissions: [] });
    return json([account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={limitedOrganization} organizations={[limitedOrganization]} /></UnsavedChangesProvider></MemoryRouter>);
  await openUserManagement('任职与授权');
  await user.click(await screen.findByRole('button', { name: '查看授权来源' }));
  const editor = await screen.findByRole('dialog', { name: 'alice · 授权来源' });
  await waitFor(() => expect(within(editor).getByText(role.name)).toBeVisible());
  expect(within(editor).queryByRole('combobox')).not.toBeInTheDocument();
  expect(within(editor).queryByRole('button', { name: '保存角色分配' })).not.toBeInTheDocument();
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'alice · 授权来源' })).not.toBeInTheDocument());
  expect(writes).toEqual([]);
}, 30000);

it('keeps the batch account modal open while creation is pending and allows closing after settlement', async () => {
  const username = 'new.user';
  const fullName = 'New User';
  const modalTitle = '批量创建账号';
  const modalSelector = '[role="dialog"]';
  const preview = {
    previewId: '9ce9604e-1df1-4569-aabd-6e3d0024bb57',
    expiresAt: '2099-01-01T00:00:00Z',
    rows: [{
      rowNumber: 2, username, fullName, accountType: 'INTERNAL', organizationCode: organization.code,
      organizationId: organization.id, organizationName: organization.name, status: 'READY',
    }],
  } satisfies components['schemas']['AdminUserBatchPreviewResultDto'];
  const result = {
    batchId: 'c1573c88-28cc-4704-854c-905648af8064',
    rows: [{ rowNumber: 2, username, status: 'SUCCESS', userId: 'd5ef2be5-8302-484f-a3a6-72a4ad19ef51', configurationRequired: true }],
  } satisfies components['schemas']['AdminUserBatchConfirmResultDto'];
  vi.mocked(readXlsxFile).mockResolvedValue([
    ['用户名', '姓名', '账号类型', '主组织', '密码'],
    [username, fullName, 'INTERNAL', organization.code, 'Example!Password42'],
  ]);
  let finish!: (response: Response) => void;
  const confirmation = new Promise<Response>(resolve => { finish = resolve; });
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path === '/api/v1/admin/users/batch/preview') return json(preview);
    if (path === '/api/v1/admin/users/batch/confirm') {
      writes.push(init);
      return confirmation;
    }
    return json([account]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={organization} organizations={[organization]} /></UnsavedChangesProvider></MemoryRouter>);
  const open = (await screen.findByText(modalTitle, { selector: 'button > span' })).closest('button')!;
  expect(open).toHaveAccessibleName(modalTitle);
  fireEvent.click(open);
  const editor = await screen.findByLabelText(modalTitle, { selector: modalSelector });
  const dialog = within(editor);
  const fileInput = dialog.getByLabelText('账号清单文件');
  await waitFor(() => expect(fileInput).toBeVisible());
  const file = new File(['xlsx'], 'accounts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await act(async () => { fireEvent.change(fileInput, { target: { files: [file] } }); });
  const confirm = dialog.getByText('创建账号', { selector: 'button > span' }).closest('button')!;
  expect(confirm).toHaveAccessibleName('创建账号');
  expect(confirm).toBeEnabled();
  await act(async () => { fireEvent.click(confirm); });
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]?.body))).toEqual({ organizationId: organization.id, previewId: preview.previewId });
  expect(fileInput).toBeDisabled();
  const close = dialog.queryByLabelText('关闭', { selector: 'button' });
  if (close) fireEvent.click(close);
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(editor).toBeInTheDocument();
  expect(editor).toBeVisible();
  expect(screen.getByLabelText(modalTitle, { selector: modalSelector })).toBe(editor);
  await act(async () => { finish(json(result)); });
  expect(dialog.getByText('成功')).toBeVisible();
  fireEvent.click(dialog.getByLabelText('关闭', { selector: 'button' }));
  await waitFor(() => expect(editor).not.toBeInTheDocument());
  expect(writes).toHaveLength(1);
});
