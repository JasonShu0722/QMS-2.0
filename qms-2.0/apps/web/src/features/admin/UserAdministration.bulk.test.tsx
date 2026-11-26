import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { registerReauthentication } from '../../api/client';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '组织 A', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:status', 'account:users:delete', 'account:roles:read', 'account:roles:assign', 'organization:structure:read', 'organization:positions:assign'] };
const alice: AdminUser = { id: 'alice-id', username: 'alice', fullName: null, phone: null, email: null, emailVerifiedAt: null, profileVersion: 1, securityVersion: 7, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: organization.id, organization, createdAt: '', updatedAt: '' };
const bob = { ...alice, id: 'bob-id', username: 'bob', securityVersion: 9 };
const oldPosition = { id: 'old-id', departmentId: null, name: '原岗位', code: 'OLD', status: 'ACTIVE' };
const newPosition = { ...oldPosition, id: 'new-id', name: '新增岗位', code: 'NEW' };
const assignment = (position: typeof oldPosition, startedAt = '2020-01-01T00:00:00Z') => ({ id: position.id, positionId: position.id, position, startedAt, endedAt: null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function server(handle: (path: string, init: RequestInit) => Response | Promise<Response> = () => json([]), users = [alice, bob]) {
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-token' });
    if (path.startsWith('/api/v1/admin/users?')) return json(users.filter(user => user.organizationId === new URLSearchParams(path.split('?')[1]).get('organizationId')));
    return handle(path, init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function select(username: string) {
  const checkbox = await screen.findByLabelText(username, { selector: 'input[type="checkbox"]' });
  await waitFor(() => expect(checkbox).toBeEnabled());
  fireEvent.click(checkbox);
}

function button(scope: ReturnType<typeof within>, label: string | RegExp) {
  return scope.getByText(label, { selector: 'button, button *' }).closest('button')!;
}

function clickButton(element: HTMLButtonElement) {
  expect(element).toBeEnabled();
  fireEvent.click(element);
}

async function open(label: string) {
  const actions = within(screen.getByLabelText('批量操作', { selector: '[role="group"]' }));
  clickButton(button(actions, label));
  const dialog = await screen.findByLabelText(label, { selector: '[role="dialog"]' });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

async function chooseNewPosition(dialog: ReturnType<typeof within>) {
  const selector = dialog.getByLabelText('任职岗位', { selector: 'input[role="combobox"]' });
  await waitFor(() => expect(selector).toBeEnabled());
  fireEvent.mouseDown(selector);
  fireEvent.click(await screen.findByText('新增岗位 · NEW', { selector: '.ant-select-item-option-content' }));
  clickButton(button(dialog, '确认追加任职'));
}

it('keeps selection across local pages and clears it when the organization changes', async () => {
  const next = { ...organization, id: 'org-b', name: '组织 B' };
  const users = Array.from({ length: 21 }, (_, index) => ({ ...alice, id: `user-${index}`, username: `account-${index}` }));
  server(undefined, [...users, { ...alice, organization: next, organizationId: next.id }]);
  const view = render(<UserAdministration organization={organization} organizations={[organization, next]} />);
  await select('account-0');
  fireEvent.click(screen.getByTitle('2'));
  await select('account-20');
  expect(screen.getByText('已选择 2 个账号')).toBeVisible();
  view.rerender(<UserAdministration organization={next} organizations={[organization, next]} />);
  await screen.findByText('alice', { selector: 'td' });
  expect(screen.queryByRole('button', { name: '批量停用' })).not.toBeInTheDocument();
});

it('does not offer batch selection to a read-only administrator', async () => {
  server();
  const readOnly = { ...organization, permissions: ['account:users:read'] };
  render(<UserAdministration organization={readOnly} organizations={[readOnly]} />);
  await screen.findByText('alice');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('disables accounts individually and retries only the uncertain request with its original key', async () => {
  let bobAttempts = 0;
  let finishAlice!: (value: Response) => void;
  const fetch = server((path) => {
    if (path.includes(alice.id)) return new Promise<Response>(resolve => { finishAlice = resolve; });
    if (++bobAttempts === 1) throw new TypeError('lost response');
    return json({ ...bob, status: 'DISABLED' });
  });
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice'); await select('bob');
  const dialog = await open('批量停用');
  const confirm = button(dialog, '确认停用');
  clickButton(confirm); fireEvent.click(confirm);
  const writes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  await waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => finishAlice(json({ ...alice, status: 'DISABLED' })));
  expect(await dialog.findByText('alice：已停用')).toBeVisible();
  expect(await dialog.findByText(/bob：请求结果尚未确认/)).toBeVisible();
  clickButton(button(dialog, '重试确认结果'));
  expect(await dialog.findByText('bob：已停用')).toBeVisible();
  expect(writes().map(([path, init]) => [path, JSON.parse(String(init?.body))])).toEqual([
    ['/api/v1/admin/users/alice-id?organizationId=org-a', { status: 'DISABLED' }],
    ['/api/v1/admin/users/bob-id?organizationId=org-a', { status: 'DISABLED' }],
    ['/api/v1/admin/users/bob-id?organizationId=org-a', { status: 'DISABLED' }],
  ]);
  expect(writes()[2][1]?.headers).toEqual(writes()[1][1]?.headers);
  expect(writes()[0][1]?.headers).not.toEqual(writes()[1][1]?.headers);
});

it('posts only selected positions and accepts an unchanged assignment list on repeat', async () => {
  let alicePositions = [assignment(oldPosition)];
  const fetch = server((path, init) => {
    if (path.includes('/departments?')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0') && !path.includes('/users/')) return json([oldPosition, newPosition]);
    if (init.method === 'POST' && path.endsWith('/positions')) {
      if (path.includes(bob.id)) return json([assignment(newPosition)]);
      if (alicePositions.length === 1) alicePositions = [...alicePositions, assignment(newPosition)];
      return json(alicePositions);
    }
    throw new Error(`Unexpected request ${path}`);
  });
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  async function append() {
    await select('alice'); await select('bob');
    const dialog = await open('批量配置任职');
    await chooseNewPosition(dialog);
    return dialog;
  }
  const dialog = await append();
  expect(await dialog.findByText('alice：任职配置已处理')).toBeVisible();
  expect(await dialog.findByText('bob：任职配置已处理')).toBeVisible();
  clickButton(button(dialog, /^关\s*闭$/));
  const repeat = await append();
  expect(await repeat.findByText('bob：任职配置已处理')).toBeVisible();
  expect(fetch.mock.calls.filter(([path]) => /\/users\/(alice|bob)-id\/positions|\/position-authorization\/preview/.test(path))
    .map(([path, init]) => [path, init?.method, JSON.parse(String(init?.body))])).toEqual([alice, bob, alice, bob].map(user => [
      `/api/v1/organizations/org-a/users/${user.id}/positions`, 'POST', { positionIds: [newPosition.id] },
    ]));
});

it('reports an append conflict per account and continues without switching to replacement', async () => {
  const fetch = server((path, init) => {
    if (path.includes('/departments?')) return json([]);
    if (init.method === 'POST') return path.includes(alice.id) ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json([assignment(newPosition)]);
    return json([oldPosition, newPosition]);
  });
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice'); await select('bob');
  const dialog = await open('批量配置任职');
  await chooseNewPosition(dialog);
  expect(await dialog.findByText('alice：记录已被其他用户更新，请刷新后重试')).toBeVisible();
  expect(await dialog.findByText('bob：任职配置已处理')).toBeVisible();
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('appends positions to a configured disabled account without sending a status update', async () => {
  const fetch = server((path, init) => {
    if (path.includes('/departments?')) return json([]);
    if (init.method === 'POST' && path.endsWith('/positions')) return json([assignment(newPosition)]);
    return json([newPosition]);
  }, [{ ...alice, status: 'DISABLED' }]);
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice');
  const dialog = await open('批量配置任职');
  await chooseNewPosition(dialog);
  expect(await dialog.findByText('alice：任职配置已处理')).toBeVisible();
  expect(fetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'PATCH'].includes(init?.method ?? ''))
    .map(([path, init]) => [path, init?.method, JSON.parse(String(init?.body))])).toEqual([
    ['/api/v1/organizations/org-a/users/alice-id/positions', 'POST', { positionIds: [newPosition.id] }],
  ]);
});

it('accepts the active assignment snapshot when the requested position is already scheduled', async () => {
  const fetch = server((path, init) => {
    if (path.includes('/departments?')) return json([]);
    if (init.method === 'POST' && path.endsWith('/positions')) return json([assignment(oldPosition)]);
    return json([oldPosition, newPosition]);
  }, [alice]);
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice');
  const dialog = await open('批量配置任职');
  await chooseNewPosition(dialog);
  expect(await dialog.findByText('alice：任职配置已处理')).toBeVisible();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(dialog.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
});

it('reports standard deletion reference blocks without issuing any force deletion', async () => {
  const fetch = server((path, init) => init.method === 'DELETE'
    ? path.includes(alice.id) ? json({ code: 'ADMIN_USER_ACTIVE_REFERENCES', traceId: 'ref-block' }, 409) : json({ userId: bob.id, deleted: true, effects: [] })
    : json([]));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice'); await select('bob');
  const ordinary = await open('批量删除');
  const writes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
  expect(writes()).toHaveLength(0);
  clickButton(button(ordinary, '确认删除'));
  expect(await ordinary.findByText(/^alice：账号存在当前引用，无法删除/)).toBeVisible();
  expect(ordinary.getByText('ref-block')).toBeVisible();
  expect(await ordinary.findByText('bob：已删除')).toBeVisible();
  expect(writes().map(([path, init]) => [path, JSON.parse(String(init?.body))])).toEqual([
    ['/api/v1/admin/users/alice-id?organizationId=org-a', { expectedSecurityVersion: 7, mode: 'STANDARD' }],
    ['/api/v1/admin/users/bob-id?organizationId=org-a', { expectedSecurityVersion: 9, mode: 'STANDARD' }],
  ]);
});

it('requires an explicit permanent deletion confirmation', async () => {
  const fetch = server((path, init) => init.method === 'DELETE'
    ? path.includes(alice.id) ? json({ userId: alice.id, deleted: true, effects: [] }) : json({ code: 'ADMIN_SELF_LOCK_FORBIDDEN' }, 409)
    : json([]));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await select('alice'); await select('bob');
  const force = await open('批量强制删除');
  expect(force.getByText('已选择 2 个账号')).toBeVisible();
  const writes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
  clickButton(button(force, /^取\s*消$/));
  expect(writes()).toHaveLength(0);
  const confirmed = await open('批量强制删除');
  clickButton(button(confirmed, '确认永久删除'));
  expect(await confirmed.findByText('alice：已永久删除')).toBeVisible();
  expect(await confirmed.findByText(/bob：不能/)).toBeVisible();
  expect(writes().map(([path, init]) => [path, JSON.parse(String(init?.body))])).toEqual([
    ['/api/v1/admin/users/alice-id?organizationId=org-a', { expectedSecurityVersion: 7, mode: 'FORCE' }],
    ['/api/v1/admin/users/bob-id?organizationId=org-a', { expectedSecurityVersion: 9, mode: 'FORCE' }],
  ]);
});

it.each([
  { action: '批量删除', confirm: '确认删除', resume: '重新确认删除', result: 'bob：已删除', mode: 'STANDARD' },
  { action: '批量强制删除', confirm: '确认永久删除', resume: '重新确认永久删除', result: 'bob：已永久删除', mode: 'FORCE' },
])('requires renewed confirmation after reauthentication for $mode', async ({ action, confirm, resume, result, mode }) => {
  let authenticated = false;
  const unregister = registerReauthentication(async () => { authenticated = true; });
  try {
    const fetch = server((path, init) => init.method === 'DELETE' && !authenticated ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403) : json({ userId: path.includes(alice.id) ? alice.id : bob.id, deleted: true, effects: [] }));
    render(<UserAdministration organization={organization} organizations={[organization]} />);
    await select('alice'); await select('bob');
    const dialog = await open(action);
    clickButton(button(dialog, confirm));
    const resumeButton = await dialog.findByLabelText<HTMLButtonElement>(resume, { selector: 'button' });
    const writes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    const modes = () => writes().map(([, init]) => JSON.parse(String(init?.body)).mode);
    expect(modes()).toEqual([mode]);
    clickButton(resumeButton);
    expect(await dialog.findByText(result)).toBeVisible();
    expect(modes()).toEqual([mode, mode, mode]);
    expect(writes()[1][1]?.headers).toEqual(writes()[0][1]?.headers);
  } finally { unregister(); }
});

it('reconfirms an uncertain permanent deletion after reauth and keeps the original write key', async () => {
  let attempts = 0;
  const unregister = registerReauthentication(async () => {});
  try {
    const fetch = server((_path, init) => {
      if (init.method !== 'DELETE') return json([]);
      if (++attempts === 1) throw new TypeError('lost response');
      if (attempts === 2) return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
      return json({ userId: alice.id, deleted: true, effects: [] });
    });
    render(<UserAdministration organization={organization} organizations={[organization]} />);
    await select('alice');
    const dialog = await open('批量强制删除');
    clickButton(button(dialog, '确认永久删除'));
    await dialog.findByText('重试确认结果');
    clickButton(button(dialog, '重试确认结果'));
    const resume = await dialog.findByLabelText<HTMLButtonElement>('重新确认永久删除', { selector: 'button' });
    expect(attempts).toBe(2);
    clickButton(resume);
    expect(await dialog.findByText('alice：已永久删除')).toBeVisible();
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(writes).toHaveLength(3);
    expect(writes.map(([path, init]) => [path, init?.body, init?.headers])).toEqual(Array(3).fill([writes[0][0], writes[0][1]?.body, writes[0][1]?.headers]));
  } finally { unregister(); }
});

it('discards an in-flight batch on organization change without writing to the remaining old accounts', async () => {
  let finishAlice!: (value: Response) => void;
  const fetch = server(() => new Promise<Response>(resolve => { finishAlice = resolve; }));
  const next = { ...organization, id: 'org-b' };
  const props = { organizations: [organization, next] };
  const view = render(<UserAdministration organization={organization} {...props} />);
  await select('alice'); await select('bob');
  const dialog = await open('批量停用');
  clickButton(button(dialog, '确认停用'));
  const writes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  await waitFor(() => expect(writes()).toHaveLength(1));
  view.rerender(<UserAdministration organization={next} {...props} />);
  expect(writes()[0][1]?.signal?.aborted).toBe(true);
  await act(async () => finishAlice(json({ ...alice, status: 'DISABLED' })));
  expect(screen.queryByRole('dialog', { name: '批量停用' })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});
