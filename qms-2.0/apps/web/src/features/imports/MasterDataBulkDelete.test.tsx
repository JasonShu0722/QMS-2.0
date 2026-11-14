import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LedgerTable } from '../../ui/ledger';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useMasterDataBulkDelete } from './MasterDataBulkDelete';
import { ApiError, registerReauthentication } from '../../api/client';

const rows = [{ id: 'a', version: 4 }, { id: 'b', version: 7 }, { id: 'c', version: 2 }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const result = { items: [{ id: 'a', status: 'DELETED' }, { id: 'b', status: 'REFERENCED' }, { id: 'c', status: 'CONFLICT' }], deleted: 1, referenced: 1, conflicted: 1, notFound: 0 };
const deleted = vi.fn();
const denied = vi.fn();
const left = vi.fn();
function Harness({ organizationId = 'org-a', allowed = true }: { organizationId?: string; allowed?: boolean }) {
  const [selection, setSelection] = useState<Record<string, { id: string; version: number }>>({});
  const requestLeave = useNavigationGuard();
  const deletion = useMasterDataBulkDelete({ organizationId, allowed, disabled: false, path: '/api/v1/material-masters/bulk-delete', noun: '物料', selection, setSelection, label: id => `记录${id}`, onDeleted: deleted, onDenied: denied });
  return <section>{deletion.feedback}{deletion.controls}<LedgerTable ledgerId="delete-test" rowKey="id" dataSource={rows} rowSelection={deletion.rowSelection(rows)} pagination={false} columns={[{ key: 'id', title: '记录', dataIndex: 'id' }]} /><button onClick={() => requestLeave(left)}>离开</button></section>;
}
function mount(organizationId = 'org-a', allowed = true) { return render(<MemoryRouter><UnsavedChangesProvider><Harness organizationId={organizationId} allowed={allowed} /></UnsavedChangesProvider></MemoryRouter>); }
async function confirm() {
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除物料' }));
  fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  return dialog;
}
beforeEach(() => { deleted.mockReset(); denied.mockReset(); left.mockReset(); useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-a'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('keeps referenced and conflicted records selected after partial deletion and displays every outcome', async () => {
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : json(result));
  vi.stubGlobal('fetch', fetcher);
  mount(); await confirm();
  expect(await screen.findByText('记录a：已删除')).toBeVisible();
  expect(screen.getByText('记录b：仍有业务引用，不能删除')).toBeVisible();
  expect(screen.getByText('记录c：版本已变化，请刷新后重新选择')).toBeVisible();
  expect(screen.getByRole('toolbar', { name: '已选物料' })).toHaveTextContent('已选择 2 条');
  expect(deleted).toHaveBeenCalledWith(['a']);
  const write = fetcher.mock.calls.find(([path]) => path.endsWith('/bulk-delete'));
  expect(write?.[1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ organizationId: 'org-a', records: rows.map(row => ({ id: row.id, expectedVersion: row.version })) }), headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String), 'x-csrf-token': 'token' }) }));
});

it('locks selection and navigation on unknown results and retries exactly the original body and key', async () => {
  let writes = 0;
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'token' });
    if (++writes === 1) throw new TypeError('network');
    return json(result);
  });
  vi.stubGlobal('fetch', fetcher);
  mount(); const dialog = await confirm();
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试删除' })).toBeEnabled());
  expect(screen.getByRole('checkbox', { name: '选择当前页' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '离开' }));
  expect(left).not.toHaveBeenCalled();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  const unloading = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(true);
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await waitFor(() => expect(left).toHaveBeenCalledTimes(1));
  const attempts = fetcher.mock.calls.filter(([path]) => path.endsWith('/bulk-delete'));
  expect(attempts).toHaveLength(2);
  expect(attempts[1][1]?.body).toBe(attempts[0][1]?.body);
  expect(attempts[1][1]?.headers).toEqual(attempts[0][1]?.headers);
});

it('invalidates an in-flight deletion after a session A to B to A change', async () => {
  let complete!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { complete = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : response));
  mount(); await confirm();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/material-masters/bulk-delete', expect.objectContaining({ method: 'POST' })));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:org-b:user-a'); useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-a'); });
  await act(async () => { complete(json(result)); await response; });
  expect(deleted).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('记录a：已删除')).not.toBeInTheDocument();
});

it('clears the operation when the organization or write permission changes and rejects late results', async () => {
  let complete!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { complete = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : response));
  const view = mount(); await confirm();
  view.rerender(<MemoryRouter><UnsavedChangesProvider><Harness organizationId="org-b" allowed={false} /></UnsavedChangesProvider></MemoryRouter>);
  await act(async () => { complete(json(result)); await response; });
  expect(deleted).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox', { name: '选择当前页' })).not.toBeInTheDocument();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('clears selected records and reports a current write denial', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : json({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403)));
  mount(); await confirm();
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(deleted).not.toHaveBeenCalled();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
});

it('preserves selection after cancelling recent authentication without reporting a permission loss', async () => {
  const unregister = registerReauthentication(async () => { throw new ApiError({ code: 'CLIENT_REAUTHENTICATION_CANCELLED', message: '' }, 400); });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED', message: '' }, 403)));
  try {
    mount(); await confirm();
    await screen.findByText('已取消身份验证，操作未提交');
    expect(denied).not.toHaveBeenCalled();
    expect(screen.getByRole('toolbar', { name: '已选物料' })).toHaveTextContent('已选择 3 条');
    expect(screen.getByRole('button', { name: '删除所选' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleted).not.toHaveBeenCalled();
  } finally { unregister(); }
});

it.each(['deleted', 'referenced', 'conflicted', 'notFound'] as const)('keeps the original command unknown when the %s count disagrees with item statuses', async field => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : json({ ...result, [field]: result[field] + 1 })));
  mount(); const dialog = await confirm();
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试删除' })).toBeEnabled());
  expect(screen.getByRole('toolbar', { name: '已选物料' })).toHaveTextContent('已选择 3 条');
  expect(screen.getByRole('checkbox', { name: '选择当前页' })).toBeDisabled();
  expect(deleted).not.toHaveBeenCalled();
  expect(denied).not.toHaveBeenCalled();
});

it('retries a malformed successful response with the original idempotency key', async () => {
  let writes = 0;
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'token' });
    return json(++writes === 1 ? { ...result, deleted: 2 } : result);
  });
  vi.stubGlobal('fetch', fetcher);
  mount(); const dialog = await confirm();
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试删除' })).toBeEnabled());
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await screen.findByText('记录a：已删除');
  const attempts = fetcher.mock.calls.filter(([path]) => path.endsWith('/bulk-delete'));
  expect(attempts).toHaveLength(2);
  expect(attempts[1][1]?.body).toBe(attempts[0][1]?.body);
  expect(attempts[1][1]?.headers).toEqual(attempts[0][1]?.headers);
});

it('keeps the original request unknown after a retry returns a definitive conflict', async () => {
  let writes = 0;
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'token' });
    writes++;
    if (writes === 1) throw new TypeError('network');
    if (writes === 2) return json({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return json(result);
  });
  vi.stubGlobal('fetch', fetcher);
  mount(); const dialog = await confirm();
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试删除' })).toBeEnabled());
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/bulk-delete'))).toHaveLength(2));
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试删除' })).toBeEnabled());
  expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '选择当前页' })).toBeDisabled();
  expect(deleted).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await screen.findByText('记录a：已删除');
  const attempts = fetcher.mock.calls.filter(([path]) => path.endsWith('/bulk-delete'));
  expect(attempts).toHaveLength(3);
  for (const attempt of attempts.slice(1)) {
    expect(attempt[1]?.body).toBe(attempts[0][1]?.body);
    expect(attempt[1]?.headers).toEqual(attempts[0][1]?.headers);
  }
});

it('rejects a late deletion response after an organization A to B to A change', async () => {
  let complete!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { complete = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'token' }) : response));
  const view = mount(); await confirm();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/material-masters/bulk-delete', expect.objectContaining({ method: 'POST' })));
  view.rerender(<MemoryRouter><UnsavedChangesProvider><Harness organizationId="org-b" /></UnsavedChangesProvider></MemoryRouter>);
  view.rerender(<MemoryRouter><UnsavedChangesProvider><Harness organizationId="org-a" /></UnsavedChangesProvider></MemoryRouter>);
  await act(async () => { complete(json(result)); await response; });
  expect(deleted).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('记录a：已删除')).not.toBeInTheDocument();
});
