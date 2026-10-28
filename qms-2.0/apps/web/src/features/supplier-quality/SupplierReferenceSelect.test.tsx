import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { SupplierReferenceSelect } from './SupplierReferenceSelect';

afterEach(() => vi.unstubAllGlobals());
const response = (items: { id: string; label: string }[], total = items.length) => new Response(JSON.stringify({ items, total }), { headers: { 'content-type': 'application/json' } });

it('resolves a selected item outside the first page and appends the next page', async () => {
  const change = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost');
    if (url.searchParams.has('selectedId')) return response([{ id: 'selected', label: '已选供应商' }]);
    return url.searchParams.get('page') === '2' ? response([{ id: 'second', label: '第二页供应商' }], 2) : response([{ id: 'first', label: '第一页供应商' }], 2);
  }));
  render(<><label htmlFor="directory">供应商</label><SupplierReferenceSelect id="directory" path="/api/directory" value="selected" onChange={change} /></>);
  expect(await screen.findByText('已选供应商')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: '供应商' }));
  await userEvent.click(await screen.findByRole('button', { name: '加载更多' }));
  await userEvent.click(await screen.findByText('第二页供应商'));
  expect(change).toHaveBeenCalledWith('second');
});

it('reports a failed directory load and retries instead of claiming an empty directory', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementation(async () => response([{ id: 'found', label: '恢复的供应商' }]));
  vi.stubGlobal('fetch', fetch);
  render(<SupplierReferenceSelect path="/api/directory" />);
  await userEvent.click(await screen.findByRole('button', { name: '重试加载选项' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByText('恢复的供应商')).toBeInTheDocument();
});

it('ignores an older directory response arriving after a new search', async () => {
  let finishOld: (response: Response) => void = () => {};
  const fetch = vi.fn(async (path: string) => {
    if (new URL(path, 'http://localhost').searchParams.get('search') === '新供应商') return response([{ id: 'new', label: '最新结果' }]);
    return new Promise<Response>((resolve) => { finishOld = resolve; });
  });
  vi.stubGlobal('fetch', fetch);
  render(<SupplierReferenceSelect path="/api/directory" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const input = screen.getByRole('combobox');
  await userEvent.click(input);
  fireEvent.change(input, { target: { value: '新供应商' } });
  expect(await screen.findByText('最新结果')).toBeInTheDocument();
  finishOld(response([{ id: 'old', label: '过期结果' }]));
  await waitFor(() => expect(screen.queryByText('过期结果')).not.toBeInTheDocument());
});

const deniedResponse = (status: number) => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: '' }), { status, headers: { 'content-type': 'application/json' } });

it.each([401, 403])('reports current list GET %s to the owner', async status => {
  const denied = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => deniedResponse(status)));
  render(<SupplierReferenceSelect path="/api/directory" onDenied={denied} />);
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(denied.mock.calls[0][0]).toBeInstanceOf(ApiError);
  expect(denied.mock.calls[0][0].status).toBe(status);
});

it.each([401, 403])('reports current selectedId GET %s to the owner', async status => {
  const denied = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('selectedId=') ? deniedResponse(status) : response([])));
  render(<SupplierReferenceSelect path="/api/directory" value="selected" onDenied={denied} />);
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(denied.mock.calls[0][0]).toBeInstanceOf(ApiError);
  expect(denied.mock.calls[0][0].status).toBe(status);
});

it.each(['list', 'selectedId'])('keeps non-auth %s errors retryable without revoking the owner', async entry => {
  const denied = vi.fn(); let failed = false;
  const fetch = vi.fn(async (path: string) => {
    const matches = path.includes('selectedId=') === (entry === 'selectedId');
    if (matches && !failed) { failed = true; return deniedResponse(503); }
    return response([{ id: 'selected', label: '恢复的选项' }]);
  });
  vi.stubGlobal('fetch', fetch);
  render(<SupplierReferenceSelect path="/api/directory" value={entry === 'selectedId' ? 'selected' : undefined} onDenied={denied} />);
  fireEvent.click(await screen.findByRole('button', { name: '重试加载选项' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试加载选项' })).not.toBeInTheDocument());
  expect(denied).not.toHaveBeenCalled();
});

it.each(['list', 'selectedId'])('uses the latest owner callback without restarting the %s GET', async entry => {
  let finish: (result: Response) => void = () => {};
  const fetch = vi.fn(async (path: string) => path.includes('selectedId=') === (entry === 'selectedId')
    ? new Promise<Response>(resolve => { finish = resolve; }) : response([]));
  vi.stubGlobal('fetch', fetch);
  const oldOwner = vi.fn(); const newOwner = vi.fn();
  const props = { path: '/api/directory', value: entry === 'selectedId' ? 'selected' : undefined };
  const view = render(<SupplierReferenceSelect {...props} onDenied={oldOwner} />);
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => path.includes('selectedId=') === (entry === 'selectedId'))).toBe(true));
  const count = fetch.mock.calls.length;
  view.rerender(<SupplierReferenceSelect {...props} onDenied={newOwner} />);
  await act(async () => finish(deniedResponse(403)));
  expect(oldOwner).not.toHaveBeenCalled();
  expect(newOwner).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(count);
});

it.each(['search', 'path', 'unmount'])('ignores an old list denial after %s', async change => {
  let finish: (result: Response) => void = () => {};
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response([]));
  vi.stubGlobal('fetch', fetch);
  const denied = vi.fn();
  const view = render(<SupplierReferenceSelect path="/api/old" onDenied={denied} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  if (change === 'search') fireEvent.change(screen.getByRole('combobox'), { target: { value: 'new' } });
  else if (change === 'path') view.rerender(<SupplierReferenceSelect path="/api/new" onDenied={denied} />);
  else view.unmount();
  await act(async () => finish(deniedResponse(403)));
  expect(denied).not.toHaveBeenCalled();
});

it.each(['value', 'path', 'unmount'])('ignores an old selectedId denial after %s', async change => {
  let finish: (result: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/old?selectedId=old')
    ? new Promise<Response>(resolve => { finish = resolve; }) : response([{ id: 'new', label: '新选项' }])));
  const denied = vi.fn();
  const view = render(<SupplierReferenceSelect path="/api/old" value="old" onDenied={denied} />);
  if (change === 'value') view.rerender(<SupplierReferenceSelect path="/api/old" value="new" onDenied={denied} />);
  else if (change === 'path') view.rerender(<SupplierReferenceSelect path="/api/new" value="old" onDenied={denied} />);
  else view.unmount();
  await act(async () => finish(deniedResponse(401)));
  expect(denied).not.toHaveBeenCalled();
});

it('keeps a denied GET local when no owner callback is supplied', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => deniedResponse(403)));
  render(<SupplierReferenceSelect path="/api/directory" />);
  expect(await screen.findByRole('button', { name: '重试加载选项' })).toBeInTheDocument();
});
