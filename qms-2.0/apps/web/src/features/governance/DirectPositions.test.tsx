import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { StructureAdministration } from './StructureAdministration';
import type { AdminOrganization } from '../admin/admin';

const organization: AdminOrganization = { id: 'org', code: 'ORG', name: '组织', type: 'INTERNAL', permissions: ['organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'] };
const department: components['schemas']['DepartmentDto'] = { id: 'dept', organizationId: organization.id, parentId: null, name: '质量科', code: 'QA', status: 'ACTIVE', version: 1 };
const direct: components['schemas']['PositionDto'] = { id: 'direct', organizationId: organization.id, departmentId: null, categoryId: null, code: 'ADMIN', name: '直属管理员', status: 'ACTIVE', version: 3 };
const departmental: components['schemas']['PositionDto'] = { ...direct, id: 'quality', departmentId: department.id, code: 'QE', name: '质量岗位' };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
type Call = { path: string; init?: RequestInit };
function setup(positions = [direct, departmental], departmentId?: string) {
  const calls: Call[] = [];
  const assignments = positions.map(position => ({ id: `a-${position.id}`, organizationId: organization.id, userId: 'user', positionId: position.id, position, startedAt: '2020-01-01T00:00:00Z', endedAt: null }));
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/position-authorization/preview')) return json({ authorizationBaseline: 'full-baseline', positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false });
    if (path.includes('/users/user/positions')) return json(assignments);
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/positions?')) return json(positions);
    if (init?.method === 'POST' || init?.method === 'PATCH') return json(direct);
    return json([]);
  }));
  render(<MemoryRouter><StructureAdministration organization={organization} workspace={{ departments: [department], departmentId, onRefresh: vi.fn(), onChanged: vi.fn() }} /></MemoryRouter>);
  return calls;
}
async function select(label: string, name: string) {
  fireEvent.mouseDown(screen.getByLabelText(label, { selector: 'input' }));
  fireEvent.click(await screen.findByText(name, { selector: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content' }));
}
const button = (name: string | RegExp) => screen.getByText(name, { selector: 'button > span' }).closest('button')!;
async function positionsTab() {
  await waitFor(() => expect(button(/^刷\s*新$/)).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: '岗位' }));
}
beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('shows only direct positions at the organization root, without a department-management tab', async () => {
  setup(); await positionsTab();
  expect(screen.getByText(direct.name)).toBeVisible();
  expect(screen.getByText('组织直属')).toBeVisible();
  expect(screen.queryByText(departmental.name)).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '管理职责' })).not.toBeInTheDocument();
});

it('creates an explicitly selected direct position with a literal null department', async () => {
  const calls = setup(); await positionsTab();
  fireEvent.click(screen.getByRole('button', { name: '新增岗位' }));
  const dialog = within(await screen.findByRole('dialog', { name: '岗位' }));
  fireEvent.change(dialog.getByLabelText('代码'), { target: { value: 'NEW' } });
  fireEvent.change(dialog.getByLabelText('名称'), { target: { value: '新直属岗' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(dialog.getByLabelText('部门').closest('.ant-form-item')).toHaveClass('ant-form-item-has-error'));
  expect(calls.some(call => call.init?.method === 'POST')).toBe(false);
  await select('部门', '组织直属');
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(calls.some(call => call.init?.method === 'POST')).toBe(true));
  expect(JSON.parse(String(calls.find(call => call.init?.method === 'POST')!.init?.body))).toEqual({ code: 'NEW', name: '新直属岗', departmentId: null, categoryId: null });
});

it('updates direct ownership to a real department with the existing CAS version', async () => {
  const calls = setup(); await positionsTab();
  fireEvent.click(within(screen.getByText(direct.name).closest('tr')!).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(await screen.findByRole('dialog', { name: '岗位' }));
  await select('部门', department.name);
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(calls.some(call => call.init?.method === 'PATCH')).toBe(true));
  expect(JSON.parse(String(calls.find(call => call.init?.method === 'PATCH')!.init?.body))).toMatchObject({ departmentId: department.id, expectedVersion: direct.version });
});

it('does not silently turn an unavailable original department into direct ownership', async () => {
  const unavailable = { ...departmental, departmentId: 'missing' };
  const calls = setup([unavailable], unavailable.departmentId); await positionsTab();
  fireEvent.click(within(screen.getByText(unavailable.name).closest('tr')!).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(await screen.findByRole('dialog', { name: '岗位' }));
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(dialog.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled());
  expect(calls.some(call => call.init?.method === 'PATCH')).toBe(false);
  await select('部门', '组织直属');
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(calls.some(call => call.init?.method === 'PATCH')).toBe(true));
  expect(JSON.parse(String(calls.find(call => call.init?.method === 'PATCH')!.init?.body))).toMatchObject({ departmentId: null });
});

it.each([undefined, department.id])('preserves direct and departmental appointment baselines while editing scope %s', async departmentId => {
  const calls = setup(undefined, departmentId);
  await waitFor(() => expect(button(/^刷\s*新$/)).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: '用户任职' }));
  fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user' } });
  fireEvent.click(button('查看任职'));
  const previewButton = await screen.findByText('预览授权', { selector: 'button > span' });
  const previewAction = previewButton.closest('button')!;
  const saveAction = button('保存任职');
  await waitFor(() => expect(previewAction).toBeEnabled());
  fireEvent.click(previewAction);
  await waitFor(() => expect(saveAction).toBeEnabled());
  fireEvent.click(saveAction);
  await waitFor(() => expect(calls.some(call => call.init?.method === 'PUT')).toBe(true));
  const body = JSON.parse(String(calls.find(call => call.init?.method === 'PUT')!.init?.body));
  expect(body.positionIds).toEqual(['direct', 'quality']);
  expect(body.expectedPositionIds).toEqual(['direct', 'quality']);
  expect(body.authorizationBaseline).toBe('full-baseline');
});

it('removes only the visible direct appointment and previews the retained departmental appointment', async () => {
  const calls = setup();
  await waitFor(() => expect(button(/^刷\s*新$/)).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: '用户任职' }));
  fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user' } });
  fireEvent.click(button('查看任职'));
  const selector = await screen.findByLabelText('任职岗位');
  await waitFor(() => expect(selector).toBeEnabled());
  const note = screen.getByText('其他范围任职（保留）').closest('.ant-alert') as HTMLElement;
  expect(note).toBeVisible();
  expect(within(note).getByText(departmental.name)).toBeVisible();
  const selection = within(selector.closest('.ant-select') as HTMLElement);
  expect(selection.getByText('直属管理员 · ADMIN')).toBeInTheDocument();
  expect(selection.queryByText('quality')).not.toBeInTheDocument();
  const previewAction = button('预览授权');
  const saveAction = button('保存任职');
  selector.focus();
  fireEvent.keyDown(selector, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
  await waitFor(() => expect(selection.queryByText('直属管理员 · ADMIN')).not.toBeInTheDocument());
  fireEvent.click(previewAction);
  await waitFor(() => expect(saveAction).toBeEnabled());
  const preview = calls.find(call => call.path.endsWith('/position-authorization/preview'))!;
  expect(JSON.parse(String(preview.init?.body))).toEqual({ positionIds: ['quality'], targetUserId: 'user' });
  fireEvent.click(saveAction);
  await waitFor(() => expect(calls.some(call => call.init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(String(calls.find(call => call.init?.method === 'PUT')!.init?.body))).toEqual({ positionIds: ['quality'], expectedPositionIds: ['direct', 'quality'], authorizationBaseline: 'full-baseline' });
});
