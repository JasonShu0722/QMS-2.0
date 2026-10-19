import { transferableAbortController } from 'node:util';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { createMemoryRouter, MemoryRouter, Link, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from './UnsavedChanges';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';

beforeEach(() => {
  useWorkTabsStore.getState().reset();
  // Keep the controller compatible with Node's native Request used by data routers.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
});
afterEach(() => vi.unstubAllGlobals());
function Editor() {
  const location = useLocation();
  useUnsavedChanges(location.pathname === '/app/edit');
  return <><output aria-label="path">{location.pathname}</output><Link to="/app/next">下一页</Link><WorkTabs /></>;
}
it('keeps edits when leaving is cancelled and leaves only after discard', async () => {
  render(<MemoryRouter initialEntries={['/app/edit']}><UnsavedChangesProvider><Editor /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: '下一页' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/edit');
  fireEvent.click(screen.getByRole('link', { name: '下一页' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/next');
});
it('closing an inactive page does not navigate away from an unsaved active editor', () => {
  const store = useWorkTabsStore.getState();
  store.openTab({ id: 'other', path: '/app/other', title: 'Other' });
  store.openTab({ id: 'edit', path: '/app/edit', title: 'Edit' });
  render(<MemoryRouter initialEntries={['/app/edit']}><UnsavedChangesProvider><Editor /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '关闭 Other' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/edit');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('sizes overflow to the available width and isolates restored pages by identity', () => {
  const store = useWorkTabsStore.getState();
  store.bindSession('INTERNAL:org:a');
  for (let i = 0; i < 8; i++) store.openTab({ id: `${i}`, title: `Page ${i}`, path: `/app/page/${i}` });
  store.setStripWidth(320);
  expect(useWorkTabsStore.getState().visibleTabs.map(tab => tab.id)).toEqual(['7']);
  store.setStripWidth(1200);
  expect(useWorkTabsStore.getState().visibleTabs.length).toBeGreaterThan(1);
  store.bindSession('INTERNAL:org:b');
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(sessionStorage.getItem('qms:work-pages:v1')).not.toContain('Page');
});

function DataEditor() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const [value, setValue] = useState('original draft');
  const [local, setLocal] = useState(0);
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  return <>
    <output aria-label="data path">{location.pathname}{location.search}{location.hash}</output>
    <input aria-label="draft" value={value} onChange={event => setValue(event.target.value)} />
    <output aria-label="local actions">{local}</output>
    <Link to="/app/first">first target</Link><Link to="/app/second">second target</Link>
    <button onClick={() => requestLeave(() => navigate('/app/first'))}>confirmed navigation</button>
    <button onClick={() => requestLeave(() => { navigate('/app/first'); navigate('/app/second'); })}>two synchronous navigations</button>
    <button onClick={() => requestLeave(() => { void Promise.resolve().then(() => navigate('/app/first')); })}>asynchronous navigation</button>
    <button onClick={() => requestLeave(() => setLocal(value => value + 1))}>local action</button>
    <button onClick={() => setBusy(true)}>start save</button>
    <button onClick={() => setBusy(false)}>end save</button>
    <button onClick={() => { setDirty(false); setBusy(false); }}>finish clean save</button>
    <WorkTabs />
  </>;
}
function dataView(initialEntries = ['/app/before', '/app/edit', '/app/after'], initialIndex = 1) {
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><DataEditor /></UnsavedChangesProvider> }], { initialEntries, initialIndex });
  render(<ConfigProvider theme={{ token: { motion: false } }}><RouterProvider router={router} /></ConfigProvider>);
  return router;
}

it.each(['PUSH', 'REPLACE', 'Back', 'Forward'] as const)('blocks %s before changing the route and preserves the draft when cancelled', async kind => {
  const router = dataView();
  fireEvent.change(screen.getByRole('textbox', { name: 'draft' }), { target: { value: 'keep my draft' } });
  const change = () => kind === 'Back' || kind === 'Forward' ? router.navigate(kind === 'Back' ? -1 : 1) : router.navigate('/app/next', { replace: kind === 'REPLACE' });
  await act(async () => { await change(); });
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  expect(router.state.location.pathname).toBe('/app/edit');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/app/edit');
  expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('keep my draft');
  await act(async () => { await change(); });
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(kind === 'Back' ? '/app/before' : kind === 'Forward' ? '/app/after' : '/app/next'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps the first route confirmation when later links or local actions are requested', async () => {
  const router = dataView();
  fireEvent.click(screen.getByRole('link', { name: 'first target' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('link', { name: 'second target' }));
  fireEvent.click(screen.getByRole('button', { name: 'local action' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/app/first'));
  expect(screen.getByLabelText('local actions')).toHaveTextContent('0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps a pending local action when a route is requested, and grants no later navigation permission', async () => {
  const router = dataView();
  fireEvent.click(screen.getByRole('button', { name: 'local action' }));
  await screen.findByRole('dialog');
  await act(async () => { await router.navigate('/app/second'); });
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByLabelText('local actions')).toHaveTextContent('1'));
  expect(router.state.location.pathname).toBe('/app/edit');
  fireEvent.click(screen.getByRole('link', { name: 'first target' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(router.state.location.pathname).toBe('/app/edit');
});

it('allows only one synchronous navigation in an explicitly confirmed action without clearing dirty registrations', async () => {
  const router = dataView();
  fireEvent.click(screen.getByRole('button', { name: 'two synchronous navigations' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(router.state.location.pathname).toBe('/app/first');
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/app/first');
});

it('confirms WorkTabs navigation once and protects the next navigation as usual', async () => {
  const store = useWorkTabsStore.getState();
  store.openTab({ id: 'first', path: '/app/first', title: 'First' });
  store.openTab({ id: 'edit', path: '/app/edit', title: 'Edit' });
  const router = dataView();
  fireEvent.click(screen.getByRole('button', { name: '关闭 Edit' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/app/first'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'second target' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(router.state.location.pathname).toBe('/app/first');
});

it('allows hash-only navigation with an unsaved draft', async () => {
  const router = dataView();
  await act(async () => { await router.navigate('/app/edit#detail'); });
  expect(router.state.location.hash).toBe('#detail');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('does not carry a confirmed local action permission into an asynchronous navigation', async () => {
  const router = dataView();
  fireEvent.click(screen.getByRole('button', { name: 'asynchronous navigation' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(router.state.location.pathname).toBe('/app/edit');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/app/edit');
});


it('retains the first pending destination when a hash navigation is requested', async () => {
  const router = dataView();
  fireEvent.click(screen.getByRole('link', { name: 'first target' }));
  await screen.findByRole('dialog');
  await act(async () => { await router.navigate('/app/edit#detail'); });
  expect(router.state.location.hash).toBe('');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/app/first'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each(['accept', 'cancel', 'saved'] as const)('retains the queued scope target across a busy hash request: %s', async outcome => {
  const router = dataView();
  fireEvent.click(screen.getByRole('button', { name: 'start save' }));
  await act(async () => { await router.navigate('/app/first'); });
  await act(async () => { await router.navigate('/app/edit#detail'); });
  expect(router.state.location.pathname).toBe('/app/edit');
  expect(router.state.location.hash).toBe('');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: outcome === 'saved' ? 'finish clean save' : 'end save' }));
  if (outcome !== 'saved') {
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: outcome === 'accept' ? '放弃修改' : '继续编辑' }));
  }
  await waitFor(() => expect(router.state.location.pathname).toBe(outcome === 'cancel' ? '/app/edit' : '/app/first'));
  expect(router.state.location.hash).toBe('');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
