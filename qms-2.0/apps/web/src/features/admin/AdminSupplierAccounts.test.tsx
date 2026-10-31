import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization, AdminUser } from './admin';
import { AdminSupplierAccounts } from './AdminSupplierAccounts';

type Page = components['schemas']['AdminSupplierAccountsPageDto'];
const organization: AdminOrganization = { id: '10000000-0000-4000-8000-000000000001', code: 'HOME', name: '平台管理公司', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:delete'] };
const principal = `INTERNAL:20000000-0000-4000-8000-000000000001:${organization.id}`;
const account: AdminUser = {
  id: '30000000-0000-4000-8000-000000000001', username: 'unbound.supplier', email: 'supplier@example.test', accountType: 'SUPPLIER', status: 'ACTIVE',
  organizationId: '40000000-0000-4000-8000-000000000001', organization: { id: '40000000-0000-4000-8000-000000000001', code: 'SUP-REAL', name: '真实供应商企业' },
  securityVersion: 17, profileVersion: 3, fullName: null, phone: null, emailVerifiedAt: null, mfaEnabled: false,
  createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
};
const base = '/api/v1/admin/supplier-accounts';
const initialPath = `${base}?search=&pageSize=20&offset=0`;
const deletePath = `${base}/${account.id}?organizationId=${account.organizationId}`;
const page = (items: Page['items'] = [account], total = items.length, offset = 0): Page => ({ items, total, pageSize: 20, offset });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function server(intercept?: (path: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    const result = intercept?.(path, init); if (result) return result;
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf-test' });
    if (path === deletePath && init.method === 'DELETE') return json({ userId: account.id, deleted: true, effects: [] });
    if (path.startsWith(`${base}?`)) return json(page());
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function scene(org = organization, onDenied = vi.fn()) {
  return <MemoryRouter><UnsavedChangesProvider><AdminSupplierAccounts organization={org} onDenied={onDenied} /></UnsavedChangesProvider></MemoryRouter>;
}
async function confirmDelete() {
  await userEvent.click(await screen.findByRole('button', { name: '永久删除用户' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog).toBeVisible());
  await userEvent.click(within(dialog).getByRole('button', { name: '确认永久删除' }));
  return dialog;
}
const reads = (fetcher: ReturnType<typeof server>) => fetcher.mock.calls.filter(([path]) => path.startsWith(`${base}?`));
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(principal); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('keeps the platform account heading accessible without a duplicate visible title', async () => {
  server();
  render(scene());
  await screen.findByText(account.username);
  const heading = screen.getByRole('heading', { name: '供应商账号（全平台）', level: 4 });
  expect(heading).toHaveClass('sr-only');
  expect(heading.parentElement).toBe(screen.getByRole('region', { name: '供应商账号（全平台）' }));
});

it('changes the real directory page size and returns to offset zero with column settings', async () => {
  const fetcher = server(path => path.startsWith(`${base}?`) ? json(page([account], 90)) : undefined);
  render(scene());
  await screen.findByText(account.username);
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(reads(fetcher).at(-1)?.[0]).toContain('offset=20'));
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByText(/^50 \//));
  await waitFor(() => expect(reads(fetcher).at(-1)?.[0]).toBe(`${base}?search=&pageSize=50&offset=0`));
  expect(screen.getByRole('button', { name: '列设置' })).toBeVisible();
});

it('reads the dedicated global directory, displays actual company data, and deletes using the real version and supplier UUID before reloading', async () => {
  let deleted = false;
  const fetcher = server((path, init) => {
    if (init.method === 'DELETE') { deleted = true; return json({ userId: account.id, deleted: true, effects: [] }); }
    if (path.startsWith(`${base}?`)) return json(page(deleted ? [] : [account]));
  });
  render(scene());
  expect(await screen.findByText(account.username)).toBeVisible();
  expect(screen.getByRole('region', { name: '供应商账号（全平台）' })).toBeVisible();
  expect(screen.getByRole('button', { name: '永久删除用户' })).toBeEnabled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  expect(screen.getByText(account.email!)).toBeVisible();
  expect(screen.getByText(account.organization.name)).toBeVisible();
  expect(screen.getByText(account.organization.code)).toBeVisible();
  expect(reads(fetcher)[0][0]).toBe(initialPath);
  await userEvent.click(screen.getByRole('button', { name: '刷新供应商账号' }));
  await waitFor(() => expect(reads(fetcher)).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '永久删除用户' })).toBeEnabled());
  await confirmDelete();
  expect(await screen.findByText('暂无供应商账号')).toBeVisible();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(deletePath);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ expectedSecurityVersion: 17 });
  expect(writes[0][1]).toMatchObject({ credentials: 'include', headers: { 'x-csrf-token': 'csrf-test', 'Idempotency-Key': expect.any(String) } });
  expect(reads(fetcher)).toHaveLength(3);
  expect(fetcher.mock.calls.some(([path]) => path.startsWith('/api/v1/admin/users') || path.includes('/profiles/'))).toBe(false);
});

it('makes no reads without the exact capability or under a supplier or absent session principal', () => {
  const fetcher = server();
  const view = render(scene({ ...organization, permissions: ['account:users:read', 'account:users:delete-extra'] }));
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(scene({ ...organization, type: 'SUPPLIER' }));
  expect(fetcher).not.toHaveBeenCalled();
  act(() => useWorkTabsStore.getState().bindSession(`SUPPLIER:20000000-0000-4000-8000-000000000002:${account.organizationId}`));
  view.rerender(scene());
  expect(fetcher).not.toHaveBeenCalled();
  act(() => useWorkTabsStore.getState().reset());
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it('offers an explicit read retry and clears every row and action on a current 403 before notifying the parent', async () => {
  let count = 0;
  const onDenied = vi.fn();
  const fetcher = server(path => path.startsWith(`${base}?`)
    ? ++count === 1 ? json({ code: 'HTTP_503' }, 503) : count === 2 ? json(page()) : json({ code: 'FEATURE_PERMISSION_DENIED', message: 'private-denial' }, 403)
    : undefined);
  render(scene(organization, onDenied));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: '刷新供应商账号' }));
  expect(await screen.findByText(account.username)).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新供应商账号' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '刷新供应商账号' }));
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  expect(screen.queryByText(account.username)).not.toBeInTheDocument();
  expect(screen.queryByText(account.email!)).not.toBeInTheDocument();
  expect(screen.queryByText(account.organization.name)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
  expect(screen.queryByText('private-denial')).not.toBeInTheDocument();
  expect(reads(fetcher)).toHaveLength(3);
});

it('aborts an old management scope read and ignores its late denial without clearing the new directory', async () => {
  const old = deferred<Response>(); const onDenied = vi.fn();
  let count = 0;
  const fetcher = server(path => path.startsWith(`${base}?`) && ++count === 1 ? old.promise : undefined);
  const view = render(scene(organization, onDenied));
  await waitFor(() => expect(reads(fetcher)).toHaveLength(1));
  const signal = reads(fetcher)[0][1]?.signal;
  view.rerender(scene({ ...organization, id: '10000000-0000-4000-8000-000000000002' }, onDenied));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText(account.username)).toBeVisible();
  await act(async () => old.resolve(json({ code: 'FEATURE_PERMISSION_DENIED' }, 403)));
  expect(screen.getByText(account.username)).toBeVisible();
  expect(onDenied).not.toHaveBeenCalled();
  expect(reads(fetcher)).toHaveLength(2);
});

it('irreversibly invalidates reads on a synchronous principal A-B-A transition', async () => {
  const old = deferred<Response>();
  const fetcher = server(path => path.startsWith(`${base}?`) ? old.promise : undefined);
  const onDenied = vi.fn(); render(scene(organization, onDenied));
  await waitFor(() => expect(reads(fetcher)).toHaveLength(1));
  const signal = reads(fetcher)[0][1]?.signal;
  act(() => {
    useWorkTabsStore.getState().bindSession(`INTERNAL:20000000-0000-4000-8000-000000000003:${organization.id}`);
    useWorkTabsStore.getState().bindSession(principal);
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(json(page())));
  expect(screen.queryByText(account.username)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
  expect(onDenied).not.toHaveBeenCalled();
  expect(reads(fetcher)).toHaveLength(1);
});

it.each(['search', 'pagination', 'refresh'] as const)('guards %s during a pending or unknown row deletion', async action => {
  const deletion = deferred<Response>();
  const fetcher = server((path, init) => init.method === 'DELETE' ? deletion.promise : path.startsWith(`${base}?`) ? json(page([account], 21)) : undefined);
  render(scene()); await screen.findByText(account.username);
  const region = screen.getByRole('region', { name: '供应商账号（全平台）' });
  const directory = within(region);
  const actualButton = (container: HTMLElement, name: string) => {
    const button = within(container).getByText(name, { selector: 'button > span' }).closest('button');
    expect(button).toBeInstanceOf(HTMLButtonElement); expect(button).toHaveAccessibleName(name);
    return button as HTMLButtonElement;
  };
  const search = directory.getByLabelText('搜索供应商账号或企业');
  expect(search).toHaveAttribute('type', 'search');
  const searchButton = search.closest('.ant-input-search')?.querySelector('button');
  if (!(searchButton instanceof HTMLButtonElement)) throw new Error('Search action not found');
  const refresh = actualButton(region, '刷新供应商账号');
  const secondPage = directory.getByTitle('2');
  fireEvent.change(search, { target: { value: 'supplier' } });
  const deleteDialog = await confirmDelete();
  const command = fetcher.mock.calls.find(([, init]) => init?.method === 'DELETE');
  expect(command).toBeDefined();
  fireEvent.click(searchButton);
  expect(reads(fetcher)).toHaveLength(1);
  await act(async () => deletion.resolve(json({ code: 'HTTP_503' }, 503)));
  await screen.findByText('删除结果尚未确认，将使用原请求重试，不会创建新的删除操作。');
  const guardTitle = await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  const guardDialog = guardTitle.closest('[role="dialog"]');
  expect(guardDialog).not.toBeNull();
  const keepEditing = actualButton(guardDialog as HTMLElement, '继续编辑');
  const retry = actualButton(deleteDialog, '重试确认结果');
  fireEvent.click(keepEditing);
  await waitFor(() => expect(guardDialog).not.toBeVisible());
  expect(retry).toBeInTheDocument();
  const navigate = () => action === 'search' ? fireEvent.click(searchButton)
    : fireEvent.click(action === 'pagination' ? secondPage : refresh);
  const visibleGuard = () => waitFor(() => {
    const dialog = screen.getByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' }).closest('[role="dialog"]');
    expect(dialog).toBeInstanceOf(HTMLElement); expect(dialog).toBeVisible();
    return dialog as HTMLElement;
  });
  navigate();
  const secondGuard = await visibleGuard();
  expect(reads(fetcher)).toHaveLength(1);
  fireEvent.click(actualButton(secondGuard, '继续编辑'));
  await waitFor(() => expect(secondGuard).not.toBeVisible());
  expect(retry).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([command]);
  navigate();
  const finalGuard = await visibleGuard();
  fireEvent.click(actualButton(finalGuard, '放弃修改'));
  await waitFor(() => expect(reads(fetcher)).toHaveLength(2));
  expect(reads(fetcher)[1][0]).toBe(`${base}?search=${action === 'search' ? 'supplier' : ''}&pageSize=20&offset=${action === 'pagination' ? 20 : 0}`);
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
});
