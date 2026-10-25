import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { MyTasksPage } from './MyTasksPage';

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('./ClosureTaskInbox', () => ({ ClosureTaskInbox: () => {
  useEffect(() => { lifecycle.mount(); return () => { lifecycle.unmount(); }; }, []);
  return <p>当前有效关闭审核职责</p>;
} }));
afterEach(() => { vi.unstubAllGlobals(); lifecycle.mount.mockClear(); lifecycle.unmount.mockClear(); });
it('mounts closure duties only on their active tab and unmounts when leaving', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter><LanguageProvider><MyTasksPage /></LanguageProvider></MemoryRouter>);
  expect(lifecycle.mount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: '关闭审核' }));
  expect(await screen.findByText('当前有效关闭审核职责')).toBeVisible();
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: '我的待办' }));
  await waitFor(() => expect(lifecycle.unmount).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('当前有效关闭审核职责')).not.toBeInTheDocument();
});
