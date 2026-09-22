import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
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
