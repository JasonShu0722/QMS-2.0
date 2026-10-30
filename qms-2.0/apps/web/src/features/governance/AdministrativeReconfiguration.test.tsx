import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import type { ReactNode } from 'react';
import { ApiError, registerReauthentication } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import type { Department, Organization } from './governance';
import { AdministrativeReconfiguration } from './AdministrativeReconfiguration';

type Item = components['schemas']['AdministrativeReconfigurationItemDto'];
const org: AdminOrganization = { id: '10000000-0000-4000-8000-000000000001', name: '管理公司', code: 'A', type: 'INTERNAL', permissions: ['organization:reconfigure', 'organization:read', 'organization:structure:read'] };
const targetId = '10000000-0000-4000-8000-000000000002';
const departmentId = '20000000-0000-4000-8000-000000000001';
const pendingId = '30000000-0000-4000-8000-000000000001';
const tree: Organization[] = [
  { id: org.id, name: org.name, code: 'A', type: 'INTERNAL', parentId: null, status: 'ACTIVE', version: 1 },
  { id: targetId, name: '目标公司', code: 'B', type: 'INTERNAL', parentId: null, status: 'ACTIVE', version: 1 },
  { id: 'disabled', name: '停用公司', code: 'D', type: 'INTERNAL', parentId: null, status: 'DISABLED', version: 1 },
  { id: 'supplier', name: '供应商', code: 'S', type: 'SUPPLIER', parentId: null, status: 'ACTIVE', version: 1 },
];
const departments = (organizationId: string): Department[] => [
  { id: departmentId, name: '质量科', code: 'QA', organizationId, parentId: null, status: 'ACTIVE', version: 2 },
  { id: 'disabled-dept', name: '停用科', code: 'OLD', organizationId, parentId: null, status: 'DISABLED', version: 1 },
  { id: 'foreign-dept', name: '外组织科室', code: 'F', organizationId: 'foreign', parentId: null, status: 'ACTIVE', version: 1 },
];
const pending = (kind: Item['kind'], requiredConfiguration: string[], originalOrganizationId = org.id): Item => ({ kind, id: pendingId, label: '待配置对象', originalOrganizationId, version: 7, reason: 'DEPARTMENT_UNAVAILABLE', requiredConfiguration });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { path: string; init?: RequestInit };
function server(item = pending('ORGANIZATION', ['parentId']), intercept?: (call: Call) => Response | Promise<Response> | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), init }; calls.push(call);
    const response = intercept?.(call); if (response) return response;
    if (call.path.endsWith('/csrf')) return json({ csrfToken: 'csrf-reconfigure' });
    if (init?.method === 'POST') return json({ kind: item.kind, id: item.id, originalOrganizationId: item.originalOrganizationId, targetOrganizationId: targetId, version: 8, status: item.kind === 'POSITION' || item.kind === 'USER' ? 'DISABLED' : 'ACTIVE', configurationRequired: false });
    if (call.path.includes('/reconfiguration?')) {
      const query = new URL(call.path, 'http://localhost').searchParams;
      const items = query.get('kind') === item.kind ? [item] : [];
      return json({ items, total: items.length, pageSize: 20, offset: Number(query.get('offset')) });
    }
    if (call.path.includes('/tree?')) return json(tree);
    if (call.path.includes('/departments?')) return json(departments(decodeURIComponent(call.path.split('/organizations/')[1].split('/')[0])));
    throw new Error(`Unexpected request: ${call.path}`);
  }));
  return calls;
}
function scene(organization = org, callbacks: { onChanged?: () => void; onDenied?: (error: ApiError) => void; renderAdditionalActions?: (item: Item, onCompleted: () => void) => ReactNode } = {}) {
  return <MemoryRouter><UnsavedChangesProvider><AdministrativeReconfiguration organization={organization} {...callbacks} /></UnsavedChangesProvider></MemoryRouter>;
}
async function select(label: string, text: string) {
  const input = screen.getByLabelText(label);
  fireEvent.mouseDown(input);
  // Virtualized role=option nodes are accessibility mirrors, not the clickable options.
  const option = await screen.findByText(text, { selector: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content' });
  await waitFor(() => { expect(option).toBeVisible(); expect(window.getComputedStyle(option).pointerEvents).not.toBe('none'); });
  // Setup drives the real option handler; pointer/keyboard acceptance remains a separate browser gate.
  fireEvent.click(option);
  await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
}
const editor = () => within(screen.getByLabelText('配置 · 待配置对象', { selector: 'section' }));
async function edit() {
  const button = await screen.findByLabelText('配置 · 待配置对象', { selector: 'button' });
  expect(button).toBeVisible(); expect(button).toBeEnabled(); fireEvent.click(button);
}
async function save() {
  const button = editor().getByRole('button', { name: '确认补配' });
  expect(button).toBeVisible(); expect(button).toBeEnabled(); fireEvent.click(button);
}
const writes = (calls: Call[]) => calls.filter(call => call.init?.method === 'POST');
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org.id}:actor`); });
afterEach(() => { vi.unstubAllGlobals(); act(() => useWorkTabsStore.getState().reset()); });

it('requires explicit POSITION ownership and posts literal null only after organization-direct is selected', async () => {
  const calls = server(pending('POSITION', ['targetDepartmentId'])); render(scene());
  await select('对象类型', '岗位'); await edit();
  await waitFor(() => expect(screen.getByLabelText('目标部门/科室')).toBeEnabled());
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  expect(writes(calls)).toEqual([]);
  await select('目标部门/科室', '组织直属');
  await save();
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(JSON.parse(String(writes(calls)[0].init?.body))).toEqual({ expectedVersion: 7, targetDepartmentId: null });
  expect(screen.getByText(/保持停用|配置已更新/)).toBeInTheDocument();
});

it('never offers organization-direct ownership for a non-POSITION required department', async () => {
  const calls = server(pending('DEPARTMENT', ['targetOrganizationId', 'targetDepartmentId'], 'deleted-org')); render(scene());
  await select('对象类型', '部门/科室'); await edit();
  await select('目标组织', '目标公司 · B');
  await waitFor(() => expect(screen.getByLabelText('目标部门/科室')).toBeEnabled());
  fireEvent.mouseDown(screen.getByLabelText('目标部门/科室'));
  expect(screen.queryByText('组织直属')).not.toBeInTheDocument();
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  expect(writes(calls)).toEqual([]);
});

it('reads the real paginated queue and directories and explains historical scope without a delete undo', async () => {
  const calls = server(); render(scene()); await edit();
  expect(calls.some(call => call.path === '/api/v1/admin/reconfiguration?kind=ORGANIZATION&pageSize=20&offset=0')).toBe(true);
  expect(screen.getByText(/原归属仅为历史范围，不迁移历史业务/)).toBeVisible();
  expect(screen.getByText(/删除不可撤销/)).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  await select('父组织', '目标公司 · B'); await save();
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(JSON.parse(writes(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, parentId: targetId });
  expect(writes(calls)[0].init!.headers).toMatchObject({ 'x-csrf-token': 'csrf-reconfigure', 'Idempotency-Key': expect.any(String) });
});

it.each([
  ['DEPARTMENT', ['parentId'], org.id, { expectedVersion: 7, parentId: null }],
  ['DEPARTMENT', ['targetOrganizationId', 'targetDepartmentId'], 'deleted-org', { expectedVersion: 7, targetOrganizationId: targetId, targetDepartmentId: departmentId }],
  ['POSITION', ['targetDepartmentId'], org.id, { expectedVersion: 7, targetDepartmentId: departmentId }],
  ['POSITION', ['targetOrganizationId', 'targetDepartmentId'], 'deleted-org', { expectedVersion: 7, targetOrganizationId: targetId, targetDepartmentId: departmentId }],
  ['USER', ['targetOrganizationId'], 'deleted-org', { expectedVersion: 7, targetOrganizationId: targetId }],
  ['USER', ['appointmentAfterReconfiguration'], org.id, { expectedVersion: 7 }],
] as const)('uses the server-required projection for %s / %j without inheriting grants', async (kind, required, source, body) => {
  const calls = server(pending(kind, [...required], source)); const onChanged = vi.fn(); render(scene(org, { onChanged }));
  await select('对象类型', { DEPARTMENT: '部门/科室', POSITION: '岗位', USER: '用户' }[kind]);
  await edit();
  if (required.includes('targetOrganizationId' as never)) await select('目标组织', '目标公司 · B');
  if (required.includes('targetDepartmentId' as never)) {
    await waitFor(() => expect(screen.getByLabelText('目标部门/科室')).toBeEnabled());
    await select('目标部门/科室', '质量科 · QA');
  }
  if (kind === 'POSITION' || kind === 'USER') expect(screen.getByText(/保持停用/)).toBeVisible();
  if (kind === 'POSITION' && source === 'deleted-org') expect(screen.getByText(/新 UUID.*不继承/)).toBeVisible();
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled()); await save();
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(writes(calls)[0].path).toBe(`/api/v1/admin/reconfiguration/${kind}/${pendingId}`);
  expect(JSON.parse(writes(calls)[0].init!.body as string)).toEqual(body);
});

it('allows a live department to select a valid same-organization parent, excluding self, descendants and inactive candidates', async () => {
  server(pending('DEPARTMENT', ['parentId']), call => call.path.includes('/departments?') ? json([...departments(org.id),
    { ...departments(org.id)[0], id: pendingId, name: '自身科室' },
    { ...departments(org.id)[0], id: 'descendant', parentId: pendingId, name: '下级科室' }]) : undefined);
  render(scene()); await select('对象类型', '部门/科室'); await edit();
  await waitFor(() => expect(screen.getByLabelText('父部门/科室')).toBeEnabled());
  fireEvent.mouseDown(screen.getByLabelText('父部门/科室'));
  expect(screen.queryByRole('option', { name: /自身科室|下级科室|停用科|外组织科室/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('质量科 · QA', { selector: '.ant-select-item-option-content' })); await save();
  await screen.findByText(/补配成功/);
});

it('freezes unknown body and key and only explicitly retries the original request, including another nonterminal retry error', async () => {
  let posts = 0;
  const calls = server(pending('POSITION', ['targetDepartmentId']), call => {
    if (call.init?.method === 'POST' && ++posts === 1) return Promise.reject(new TypeError('connection lost'));
    if (call.init?.method === 'POST' && posts === 2) return json({ code: 'RATE_LIMITED', message: 'retry later' }, 429);
  });
  render(scene()); await select('对象类型', '岗位'); await edit();
  const form = editor();
  const department = form.getByLabelText('目标部门/科室');
  const toolbar = within(screen.getByLabelText('对象类型').closest('.administrative-reconfiguration-toolbar')!);
  const refresh = toolbar.getByRole('button', { name: '刷新待配置' });
  await waitFor(() => expect(department).toBeEnabled());
  await select('目标部门/科室', '质量科 · QA'); await save();
  await screen.findByText(/结果尚未确认/);
  expect(department).toBeDisabled();
  expect(refresh).toBeDisabled();
  expect(writes(calls)).toHaveLength(1);
  const retry = form.getByRole('button', { name: '重试原补配请求' });
  fireEvent.click(retry);
  await waitFor(() => expect(writes(calls)).toHaveLength(2));
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await screen.findByText(/补配成功/);
  expect(writes(calls)).toHaveLength(3);
  expect(new Set(writes(calls).map(call => call.init!.body)).size).toBe(1);
  expect(new Set(writes(calls).map(call => (call.init!.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1);
});

it('preserves the draft on 409 and reads a newer version only after explicit refresh', async () => {
  let version = 7; let posts = 0;
  const calls = server(pending('ORGANIZATION', ['parentId']), call => {
    if (call.path.includes('/reconfiguration?')) return json({ items: [{ ...pending('ORGANIZATION', ['parentId']), version }], total: 1, pageSize: 20, offset: 0 });
    if (call.init?.method === 'POST' && ++posts === 1) { version = 8; return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409); }
  });
  render(scene()); await edit(); await select('父组织', '目标公司 · B'); await save();
  await screen.findByText(/版本已变化/);
  expect(calls.filter(call => call.path.includes('/reconfiguration?'))).toHaveLength(1);
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  fireEvent.click(editor().getByRole('button', { name: '刷新版本并保留草稿' }));
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled());
  expect(within(screen.getByLabelText('父组织').closest('.ant-select')!).getByText('目标公司 · B')).toBeVisible(); await save();
  await waitFor(() => expect(writes(calls)).toHaveLength(2));
  expect(JSON.parse(writes(calls)[1].init!.body as string)).toEqual({ expectedVersion: 8, parentId: targetId });
});

it.each([
  ['list', 401], ['list', 403], ['tree', 401], ['tree', 403],
] as const)('clears the 409 draft for a late parallel read denial after %s fails first (%s)', async (first, status) => {
  let refreshing = false;
  let releaseFirst!: (response: Response) => void;
  let releaseDenied!: (response: Response) => void;
  const calls = server(pending('ORGANIZATION', ['parentId']), call => {
    if (call.init?.method === 'POST') return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
    const branch = call.path.includes('/reconfiguration?') ? 'list' : call.path.includes('/tree?') ? 'tree' : undefined;
    if (refreshing && branch) return new Promise(resolve => { if (branch === first) releaseFirst = resolve; else releaseDenied = resolve; });
  });
  const onDenied = vi.fn(); render(scene(org, { onDenied }));
  await edit(); await select('父组织', '目标公司 · B'); await save();
  await screen.findByText(/版本已变化/);
  expect(within(screen.getByLabelText('父组织').closest('.ant-select')!).getByText('目标公司 · B')).toBeVisible();
  refreshing = true;
  fireEvent.click(editor().getByRole('button', { name: '刷新版本并保留草稿' }));
  expect(releaseFirst).toBeTypeOf('function'); expect(releaseDenied).toBeTypeOf('function');
  await act(async () => releaseFirst(json({ code: 'HTTP_500', message: 'read failed' }, 500)));
  await waitFor(() => expect(editor().getByRole('button', { name: '刷新版本并保留草稿' })).toBeEnabled());
  expect(editor().getByText('7')).toBeVisible();
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  expect(onDenied).not.toHaveBeenCalled();
  await act(async () => releaseDenied(json({ code: 'FEATURE_PERMISSION_DENIED', message: 'late denial' }, status)));
  await waitFor(() => expect(onDenied).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status })));
  expect(screen.getByText(/管理权限或会话已失效/)).toBeVisible();
  expect(screen.queryByText('待配置对象')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('配置 · 待配置对象', { selector: 'section' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('父组织')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试原补配请求' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '刷新版本并保留草稿' })).not.toBeInTheDocument();
  expect(calls.filter(call => call.path.includes('/reconfiguration?'))).toHaveLength(2);
  expect(calls.filter(call => call.path.includes('/tree?'))).toHaveLength(2);
  expect(writes(calls)).toHaveLength(1);
});

it.each([
  ['list', 401], ['list', 403], ['tree', 401], ['tree', 403],
] as const)('keeps the new scope draft when the old parallel read denies after %s fails first (%s)', async (first, status) => {
  let refreshing = false;
  let releaseFirst!: (response: Response) => void;
  let releaseDenied!: (response: Response) => void;
  const calls = server(pending('ORGANIZATION', ['parentId']), call => {
    if (call.init?.method === 'POST') return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
    const branch = call.path.includes('/reconfiguration?') ? 'list' : call.path.includes('/tree?') ? 'tree' : undefined;
    if (refreshing && branch) return new Promise(resolve => { if (branch === first) releaseFirst = resolve; else releaseDenied = resolve; });
  });
  const onDenied = vi.fn(); const view = render(scene(org, { onDenied }));
  await edit();
  fireEvent.keyDown(screen.getByLabelText('父组织'), { key: 'ArrowDown', keyCode: 40, which: 40 });
  fireEvent.keyDown(screen.getByLabelText('父组织'), { key: 'Enter', keyCode: 13, which: 13 });
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled()); await save();
  await screen.findByText(/版本已变化/);
  refreshing = true;
  fireEvent.click(editor().getByRole('button', { name: '刷新版本并保留草稿' }));
  expect(releaseFirst).toBeTypeOf('function'); expect(releaseDenied).toBeTypeOf('function');
  await act(async () => releaseFirst(json({ code: 'HTTP_500', message: 'read failed' }, 500)));
  await waitFor(() => expect(editor().getByRole('button', { name: '刷新版本并保留草稿' })).toBeEnabled());
  refreshing = false;
  view.rerender(scene({ ...org, id: targetId }, { onDenied }));
  await edit();
  fireEvent.keyDown(screen.getByLabelText('父组织'), { key: 'ArrowDown', keyCode: 40, which: 40 });
  fireEvent.keyDown(screen.getByLabelText('父组织'), { key: 'Enter', keyCode: 13, which: 13 });
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled());
  await act(async () => releaseDenied(json({ code: 'FEATURE_PERMISSION_DENIED', message: 'old scope' }, status)));
  expect(onDenied).not.toHaveBeenCalled();
  expect(screen.queryByText(/管理权限或会话已失效/)).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('父组织').closest('.ant-select')!).getByText('管理公司 · A')).toBeVisible();
  expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled();
  expect(calls.filter(call => call.path.includes('/reconfiguration?'))).toHaveLength(3);
  expect(calls.filter(call => call.path.includes('/tree?'))).toHaveLength(3);
  expect(writes(calls)).toHaveLength(1);
});

it.each([401, 403])('clears all projections and notifies the parent for denied writes (%s)', async status => {
  const onDenied = vi.fn(); const calls = server(pending('ORGANIZATION', ['parentId']), call => call.init?.method === 'POST' ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, status) : undefined);
  render(scene(org, { onDenied })); await edit(); await select('父组织', '目标公司 · B'); await save();
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  expect(screen.queryByText('待配置对象')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '父组织' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试原补配请求' })).not.toBeInTheDocument();
  expect(writes(calls)).toHaveLength(1);
});

it('does not send POST after a principal switch while CSRF is pending', async () => {
  let release!: (response: Response) => void;
  const calls = server(pending('ORGANIZATION', ['parentId']), call => call.path.endsWith('/csrf') ? new Promise(resolve => { release = resolve; }) : undefined);
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await edit(); await select('父组织', '目标公司 · B'); await save();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:new-actor'));
  await act(async () => release(json({ csrfToken: 'old-csrf' })));
  expect(writes(calls)).toHaveLength(0); expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox', { name: '父组织' })).not.toBeInTheDocument();
});

it('discards frozen unknown attempts on an organization switch', async () => {
  const calls = server(pending('ORGANIZATION', ['parentId']), call => call.init?.method === 'POST' ? Promise.reject(new TypeError('lost')) : undefined);
  const view = render(scene()); await edit(); await select('父组织', '目标公司 · B'); await save(); await screen.findByText(/结果尚未确认/);
  view.rerender(scene({ ...org, id: targetId }));
  await screen.findByRole('button', { name: '配置 · 待配置对象' });
  expect(screen.queryByRole('button', { name: '重试原补配请求' })).not.toBeInTheDocument();
  expect(writes(calls)).toHaveLength(1);
});

it('ignores a late denied POST from the old organization without clearing the new scope or notifying its parent', async () => {
  let release!: (response: Response) => void;
  const calls = server(pending('ORGANIZATION', ['parentId']), call => call.init?.method === 'POST' ? new Promise(resolve => { release = resolve; }) : undefined);
  const onChanged = vi.fn(); const onDenied = vi.fn(); const view = render(scene(org, { onChanged, onDenied }));
  await edit(); await select('父组织', '目标公司 · B'); await save();
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  view.rerender(scene({ ...org, id: targetId }, { onChanged, onDenied }));
  await screen.findByLabelText('配置 · 待配置对象', { selector: 'button' });
  await act(async () => release(json({ code: 'FEATURE_PERMISSION_DENIED', message: 'old scope' }, 403)));
  expect(onDenied).not.toHaveBeenCalled(); expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByLabelText('配置 · 待配置对象', { selector: 'button' })).toBeEnabled();
  expect(screen.queryByText(/管理权限或会话已失效/)).not.toBeInTheDocument();
});

it('does not auto replay after reauthentication and retains the original key for an explicit retry', async () => {
  let posts = 0;
  const reauthenticate = vi.fn(async () => {}); const unregister = registerReauthentication(reauthenticate);
  try {
    const calls = server(pending('ORGANIZATION', ['parentId']), call => call.init?.method === 'POST' && ++posts === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED', message: 'reauth' }, 403) : undefined);
    render(scene()); await edit(); await select('父组织', '目标公司 · B'); await save();
    await screen.findByRole('button', { name: '重试原补配请求' }); expect(writes(calls)).toHaveLength(1);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    fireEvent.click(editor().getByRole('button', { name: '重试原补配请求' })); await screen.findByText(/补配成功/);
    expect(writes(calls)[1].init!.headers).toEqual(writes(calls)[0].init!.headers);
  } finally { unregister(); }
});

it('guards dirty cancel and keeps the selected draft when continuing to edit', async () => {
  server(); render(scene()); await edit(); await select('父组织', '目标公司 · B');
  await userEvent.click(screen.getByRole('button', { name: '关闭编辑' }));
  const confirmation = await screen.findByRole('dialog');
  await userEvent.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(within(screen.getByLabelText('父组织').closest('.ant-select')!).getByText('目标公司 · B')).toBeVisible();
});

it('exposes a read retry rather than treating a failed directory as empty', async () => {
  let reads = 0;
  server(pending('ORGANIZATION', ['parentId']), call => call.path.includes('/tree?') && ++reads === 1 ? Promise.reject(new TypeError('offline')) : undefined);
  render(scene()); await screen.findByRole('button', { name: '重试读取' });
  expect(screen.queryByRole('button', { name: '配置 · 待配置对象' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试读取' })); await edit();
});

it('renders a real empty queue and refuses unknown requiredConfiguration values', async () => {
  server(pending('POSITION', ['unrecognized']), call => call.path.includes('kind=ORGANIZATION') ? json({ items: [], total: 0, pageSize: 20, offset: 0 }) : undefined);
  render(scene()); await screen.findByText('暂无待配置对象'); await select('对象类型', '岗位'); await edit();
  expect(screen.getByText(/配置要求暂不支持/)).toBeVisible(); expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
});

it('passes the complete generated pending USER item to the parent-owned additional action slot', async () => {
  const item = pending('USER', ['targetOrganizationId'], 'deleted-original-organization');
  const action = vi.fn(); const renderAdditionalActions = vi.fn((entry: Item) => <button onClick={() => action(entry.originalOrganizationId, entry.version)}>父删除入口</button>);
  const calls = server(item); render(scene(org, { renderAdditionalActions })); await select('对象类型', '用户');
  await userEvent.click(await screen.findByRole('button', { name: '父删除入口' }));
  expect(renderAdditionalActions).toHaveBeenCalledWith(item, expect.any(Function));
  expect(action).toHaveBeenCalledWith(item.originalOrganizationId, item.version);
  expect(writes(calls)).toHaveLength(0);
});

it('refreshes the same USER kind through the parent deletion completion callback without remounting or stale-scope effects', async () => {
  let completed = false;
  let oldCompletion: (() => void) | undefined;
  const item = pending('USER', ['targetOrganizationId'], 'deleted-org');
  const calls = server(item, call => call.path.includes('/reconfiguration?') && completed ? json({ items: [], total: 0, pageSize: 20, offset: 0 }) : undefined);
  const renderAdditionalActions = (_item: Item, onCompleted: () => void) => {
    oldCompletion = onCompleted;
    return onCompleted ? <button onClick={() => { completed = true; onCompleted(); }}>父删除完成</button> : null;
  };
  const view = render(scene(org, { renderAdditionalActions })); await select('对象类型', '用户');
  await userEvent.click(await screen.findByRole('button', { name: '父删除完成' }));
  await screen.findByText('暂无待配置对象');
  const reads = calls.filter(call => call.path.includes('/reconfiguration?'));
  expect(reads.at(-1)!.path).toBe('/api/v1/admin/reconfiguration?kind=USER&pageSize=20&offset=0');
  expect(screen.getByLabelText('对象类型').closest('.ant-select')).toHaveTextContent('用户');
  view.rerender(scene({ ...org, id: targetId }, { renderAdditionalActions })); await screen.findByText('暂无待配置对象');
  const count = calls.length; act(() => oldCompletion?.());
  expect(calls).toHaveLength(count);
});

it('rejects a partially understood required projection instead of silently choosing a root department', async () => {
  const calls = server(pending('DEPARTMENT', ['targetOrganizationId'])); render(scene()); await select('对象类型', '部门/科室'); await edit();
  await select('目标组织', '目标公司 · B');
  await screen.findByText(/配置要求暂不支持/);
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled(); expect(writes(calls)).toHaveLength(0);
});

it('restores a USER only through required organization fields, with no department, appointment, status or role grants', async () => {
  const calls = server(pending('USER', ['targetOrganizationId'], 'deleted-org')); render(scene()); await select('对象类型', '用户'); await edit();
  await select('目标组织', '目标公司 · B');
  expect(screen.queryByLabelText(/目标部门\/科室/)).not.toBeInTheDocument();
  expect(screen.getByText(/补配后请另在用户或岗位管理中显式配置任职并启用/)).toBeVisible();
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled());
  await save(); await screen.findByText(/补配成功/);
  expect(JSON.parse(writes(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, targetOrganizationId: targetId });
  expect(calls.some(call => call.path.includes('/departments?'))).toBe(false);
});

it.each([401, 403])('clears pending rows and editor when the target department directory denies access (%s)', async status => {
  const onDenied = vi.fn(); const calls = server(pending('POSITION', ['targetDepartmentId']), call => call.path.includes('/departments?') ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, status) : undefined);
  render(scene(org, { onDenied })); await select('对象类型', '岗位'); await edit();
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  expect(screen.queryByText('待配置对象')).not.toBeInTheDocument(); expect(writes(calls)).toHaveLength(0);
});

it('supports keyboard-only parent selection and submit using the same real mutation', async () => {
  const calls = server(); render(scene()); await edit();
  const parent = screen.getByLabelText('父组织'); parent.focus();
  // rc-select consumes legacy which codes, which jsdom's user-event does not populate.
  fireEvent.keyDown(parent, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
  await screen.findByRole('option', { name: '管理公司 · A' });
  fireEvent.keyDown(parent, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  await waitFor(() => expect(editor().getByRole('button', { name: '确认补配' })).toBeEnabled());
  editor().getByRole('button', { name: '确认补配' }).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(JSON.parse(writes(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, parentId: org.id });
});

it('does not replay a malformed successful receipt with a new key; requires explicit read reconciliation instead', async () => {
  const calls = server(pending('ORGANIZATION', ['parentId']), call => call.init?.method === 'POST' ? json({}) : undefined);
  render(scene()); await edit(); await select('父组织', '目标公司 · B'); await save();
  await screen.findByRole('button', { name: '刷新版本并保留草稿' });
  expect(screen.queryByRole('button', { name: '重试原补配请求' })).not.toBeInTheDocument();
  expect(editor().getByRole('button', { name: '确认补配' })).toBeDisabled();
  expect(writes(calls)).toHaveLength(1);
  expect(within(screen.getByLabelText('父组织').closest('.ant-select')!).getByText('目标公司 · B')).toBeVisible();
});
