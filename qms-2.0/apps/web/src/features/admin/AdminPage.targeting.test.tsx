import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';
import type { AdminOrganization } from './admin';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';

vi.mock('./UserAdministration', () => ({ UserAdministration: ({ organization, targetUserId }: { organization: AdminOrganization; targetUserId?: string }) => {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return <div data-testid="users">{organization.id}:{targetUserId ?? 'no-target'}<button onClick={() => setDirty(true)}>编辑账号草稿</button>{dirty && <span>账号草稿未保存</span>}</div>;
} }));
vi.mock('./PermissionMatrix', () => ({ PermissionMatrix: ({ onBusyChange }: { onBusyChange: (value: boolean) => void }) => {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return <><button onClick={() => setDirty(true)}>编辑矩阵草稿</button>{dirty && <span data-testid="matrix-dirty">矩阵草稿未保存</span>}<button onClick={() => onBusyChange(true)}>矩阵保存中</button><button onClick={() => onBusyChange(false)}>矩阵保存结束</button></>;
} }));
vi.mock('./RoleAdministration', () => ({ RoleAdministration: () => <div>角色内容</div> }));
vi.mock('../governance/OrganizationAdministration', () => ({ OrganizationAdministration: () => null }));
vi.mock('../governance/StructureAdministration', () => ({ StructureAdministration: () => null }));
vi.mock('../governance/ConfigurationAdministration', () => ({ ConfigurationAdministration: () => null }));
vi.mock('../governance/AuditAdministration', () => ({ AuditAdministration: () => <div>审计内容</div> }));
vi.mock('../governance/OutboxAdministration', () => ({ OutboxAdministration: () => null }));
vi.mock('../supplier-quality/SupplierProfilesPage', () => ({ SupplierProfilesPage: () => <div>供应商页面</div> }));
vi.mock('../customer-quality/CustomerMasterSection', () => ({ CustomerMasterSection: () => <div>客户页面</div> }));
vi.mock('../material-master/MaterialMasterPage', () => ({ MaterialMasterPage: () => <div>物料页面</div> }));

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org = (id: string, permissions = ['account:users:read']): AdminOrganization => ({ id, name: id === orgA ? '甲组织' : '乙组织', code: id === orgA ? 'a' : 'b', type: 'INTERNAL', permissions });
const target = (organizationId = orgB, userId = userA) => `?organizationId=${organizationId}&section=users&userId=${userId}`;
let navigate: ReturnType<typeof useNavigate>;
function RouteControls() {
  navigate = useNavigate();
  const location = useLocation();
  return <><output data-testid="url">{location.search}</output><Link to={`/app/admin${target(orgB, userB)}`}>另一审计账号</Link></>;
}
function view(organizations: AdminOrganization[] | null = [org(orgA), org(orgB)], search = '') {
  const wrap = (entries: AdminOrganization[] | null) => <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={[`/app/admin${search}`]}><UnsavedChangesProvider><RouteControls /><AdminPage organizations={entries} /></UnsavedChangesProvider></MemoryRouter></ConfigProvider>;
  const result = render(wrap(organizations));
  return { ...result, directory: (entries: AdminOrganization[] | null) => result.rerender(wrap(entries)) };
}
async function switchOrganization(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: '管理组织' }));
  await userEvent.click(screen.getByText(name, { selector: '.ant-select-item-option-content' }));
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('C master navigation', () => {
it('places authorized supplier, customer and material tabs together in that order', () => {
  view([org(orgA, ['supplier-quality:profiles:read', 'customer-quality:complaints:read', 'material-master:read', 'organization:read', 'audit:read'])]);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['供应商清单', '客户清单', '物料清单', '组织结构', '管理审计']);
});

it('allows a customer write-only entry without adding unauthorized supplier or material entries', async () => {
  view([org(orgA, ['customer-quality:complaints:write'])]);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['客户清单']);
  expect(await screen.findByText('客户页面')).toBeVisible();
});

it.each(['material-master:read', 'material-master:write', 'material-master:import'])('retains the independent %s entry permission', (permission) => {
  view([org(orgA, [permission])]);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['物料清单']);
});

it.each(['supplier-quality:profiles:read', 'supplier-quality:profiles:write'])('retains the independent %s entry permission', (permission) => {
  view([org(orgA, [permission])]);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['供应商清单']);
});
});

describe('D account targeting', () => {
it('opens the explicitly authorized organization and passes the target user to its users section', () => {
  view(undefined, target());
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgB}:${userA}`);
  expect(screen.getByRole('tab', { name: '用户' })).toHaveAttribute('aria-selected', 'true');
});

it('accepts UUID letter casing while using the directory organization identity', () => {
  const id = 'abcdefab-cdef-4abc-8abc-abcdefabcdef';
  view([org(id)], target(id.toUpperCase(), userA.toUpperCase()));
  expect(screen.getByTestId('users')).toHaveTextContent(`${id}:${userA}`);
});

it('keeps the old non-UUID organization behavior without targeting parameters or a router', () => {
  render(<AdminPage organizations={[org('org')]} />);
  expect(screen.getByTestId('users')).toHaveTextContent('org:no-target');
});

it.each([
  '?organizationId=org&section=users&userId=' + userA,
  target(orgB, 'invalid'),
  target() + '&userId=' + userB,
  target() + '&organizationId=' + orgA,
  target() + '&section=users',
  target().replace('section=users', 'section=audit-log'),
  target().replace('&section=users', ''),
  '?section=users',
  '?userId=' + userA,
  '?organizationId=' + orgB,
  target().replace('userId=' + userA, 'userId='),
  target('33333333-3333-4333-8333-333333333333'),
])('rejects invalid, partial, duplicate or unauthorized targets without falling back: %s', (search) => {
  view(undefined, search);
  expect(screen.getByRole('alert')).toHaveTextContent(/账号定位/);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
});

it('rejects targeting with only users:create in the target organization even if another organization has read', () => {
  view([org(orgA), org(orgB, ['account:users:create'])], target());
  expect(screen.getByRole('alert')).toHaveTextContent(/账号定位/);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
});

it('waits for the authorized organization directory before applying the target', async () => {
  const result = view(null, target());
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  result.directory([org(orgA), org(orgB)]);
  expect(await screen.findByTestId('users')).toHaveTextContent(`${orgB}:${userA}`);
});

it.each(['removed', 'read-revoked'] as const)('immediately removes old account details when the directory is %s', (change) => {
  const result = view(undefined, target());
  expect(screen.getByTestId('users')).toHaveTextContent(userA);
  result.directory(change === 'removed' ? [org(orgA)] : [org(orgA), org(orgB, ['account:users:create'])]);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/账号定位/);
});

it('does not reapply a consumed target after a manual organization switch', async () => {
  const result = view(undefined, target());
  await switchOrganization('甲组织 · a');
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgA}:no-target`);
  result.directory([org(orgA), org(orgB)]);
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgA}:no-target`);
  await switchOrganization('乙组织 · b');
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgB}:no-target`);
});

it('keeps a consumed target consumed on a hash-only navigation', async () => {
  view(undefined, target());
  await switchOrganization('甲组织 · a');
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgA}:no-target`);
  await act(async () => navigate(`/app/admin${target()}#detail`));
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgA}:no-target`);
});

it('accepts a fresh query after the tab was manually changed', async () => {
  view([org(orgA, ['account:users:read', 'audit:read']), org(orgB)], target(orgA));
  fireEvent.click(screen.getByRole('tab', { name: '管理审计' }));
  await act(async () => navigate(`/app/admin${target(orgB, userB)}`));
  expect(await screen.findByTestId('users')).toHaveTextContent(`${orgB}:${userB}`);
  expect(screen.getByRole('tab', { name: '用户' })).toHaveAttribute('aria-selected', 'true');
});

it.each([
  ['programmatic', orgA], ['link', orgA], ['programmatic', orgB], ['link', orgB],
] as const)('guards %s query changes from %s while an account draft is unsaved', async (kind, initialOrganization) => {
  view(undefined, target(initialOrganization));
  fireEvent.click(screen.getByRole('button', { name: '编辑账号草稿' }));
  const change = async () => { if (kind === 'link') await userEvent.click(screen.getByRole('link', { name: '另一审计账号' })); else await act(async () => navigate(`/app/admin${target(orgB, userB)}`)); };
  await change();
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(screen.getByTestId('users')).toHaveTextContent(`${initialOrganization}:${userA}`);
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByTestId('users')).toHaveTextContent(`${initialOrganization}:${userA}`);
  expect(screen.getByText('账号草稿未保存')).toBeVisible();
  expect(screen.getByTestId('url')).toHaveTextContent(target(initialOrganization));
  await change();
  await userEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByTestId('users')).toHaveTextContent(`${orgB}:${userB}`));
  expect(screen.queryByText('账号草稿未保存')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('guards manual organization changes with the shared account draft confirmation', async () => {
  view(undefined, target(orgA));
  fireEvent.click(screen.getByRole('button', { name: '编辑账号草稿' }));
  await switchOrganization('乙组织 · b');
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByTestId('users')).toHaveTextContent(`${orgA}:${userA}`);
  await switchOrganization('乙组织 · b');
  await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByTestId('users')).toHaveTextContent(`${orgB}:no-target`));
});

it.each(['programmatic', 'link'] as const)('protects a dirty matrix from %s query changes and can cancel or discard', async (kind) => {
  view([org(orgA, ['account:roles:read']), org(orgB)]);
  const change = async () => { if (kind === 'link') await userEvent.click(screen.getByRole('link', { name: '另一审计账号' })); else await act(async () => navigate(`/app/admin${target()}`)); };
  fireEvent.click(screen.getByRole('tab', { name: '权限矩阵' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑矩阵草稿' }));
  await change();
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存，继续将放弃修改。');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('tab', { name: '权限矩阵' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('matrix-dirty')).toBeVisible();
  expect(screen.getByTestId('url').textContent).toBe('');
  await change();
  const confirmation = within(await screen.findByRole('dialog'));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await userEvent.click(confirmation.getByRole('button', { name: '放弃修改' }));
  expect(await screen.findByTestId('users')).toHaveTextContent(`${orgB}:${kind === 'link' ? userB : userA}`);
});

it.each(['programmatic', 'link'] as const)('does not change the account scope on %s navigation while a matrix save is busy', async (kind) => {
  view([org(orgA, ['account:roles:read']), org(orgB)]);
  fireEvent.click(screen.getByRole('tab', { name: '权限矩阵' }));
  fireEvent.click(screen.getByRole('button', { name: '矩阵保存中' }));
  if (kind === 'link') await userEvent.click(screen.getByRole('link', { name: '另一审计账号' }));
  else await act(async () => navigate(`/app/admin${target()}`));
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  expect(screen.getByTestId('url').textContent).toBe('');
  expect(screen.getByRole('combobox', { name: '管理组织' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '矩阵保存结束' }));
  expect(await screen.findByTestId('users')).toHaveTextContent(`${orgB}:${kind === 'link' ? userB : userA}`);
});
});
