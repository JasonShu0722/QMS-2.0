import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthenticatedRoute } from '../features/auth/AuthenticatedRoute';
import { LanguageProvider } from '../i18n/Language';
import { ConsoleLayout } from '../console/ConsoleLayout';
import { getConsoleContext } from '../console/console-api';
import type { ConsoleContext } from '../console/console-navigation';
import { InternalLayout } from './InternalLayout';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useNavigationBusy, useUnsavedChanges } from './UnsavedChanges';

vi.mock('../workbench/Workbench', () => ({ Workbench: () => <GuardProbe /> }));
vi.mock('../features/supplier-pcn/SupplierPcnPage', () => ({ SupplierPcnPage: () => <div>PCN ledger</div> }));
vi.mock('../layouts/AnnouncementReminder', () => ({ AnnouncementReminder: () => null }));
vi.mock('../console/console-api', () => ({ getConsoleContext: vi.fn() }));

const organization = { id: 'a', code: 'A', name: 'Organization A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const context: ConsoleContext = {
  actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: organization },
  targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false,
  modules: [
    { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'a', permissions: ['account:users:read'] },
    { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: 'a', permissions: ['workflow:manage'] },
  ],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const session = { user: { id: 'actor', organizationId: 'a', accountType: 'INTERNAL' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' };
const getContext = vi.mocked(getConsoleContext);
let finishSession: (value: Response) => void;
const originalNodeEnvironment = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().reset();
  getContext.mockReset(); getContext.mockResolvedValue(context);
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) {
      if (++reads === 1) return response(session);
      return new Promise<Response>(resolve => { finishSession = resolve; });
    }
    return response({ items: [], permissions: [] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); process.env.NODE_ENV = originalNodeEnvironment; });

function mount(portal: 'business' | 'console' = 'business', path?: string) {
  return render(<MemoryRouter initialEntries={[path ?? (portal === 'business' ? '/app/workbench' : '/console/users')]}><LanguageProvider><Routes>
    <Route path="/app/*" element={<AuthenticatedRoute accountType="INTERNAL"><InternalLayout /></AuthenticatedRoute>} />
    <Route path="/console/*" element={<AuthenticatedRoute accountType="INTERNAL"><ConsoleLayout><p>Verified console page</p></ConsoleLayout></AuthenticatedRoute>} />
    <Route path="/login" element={<p>Login destination</p>} />
  </Routes></LanguageProvider></MemoryRouter>);
}
function businessNavigation() { return within(screen.getByRole('navigation', { name: '内部领域导航' })); }
function GuardProbe() {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(dirty); useNavigationBusy(busy);
  return <div>Workbench<button onClick={() => setDirty(value => !value)}>Toggle dirty</button><button onClick={() => setBusy(value => !value)}>Toggle busy</button></div>;
}

it('restores business scroll and expanded domains only after the real route session gate succeeds', async () => {
  mount();
  await screen.findByRole('navigation', { name: '内部领域导航' });
  fireEvent.click(businessNavigation().getByRole('button', { name: '问题中心' }));
  fireEvent.click(businessNavigation().getByRole('button', { name: '供应商质量' }));
  const sidebar = document.querySelector<HTMLElement>('.qms-primary-navigation')!;
  sidebar.scrollTop = 240; fireEvent.scroll(sidebar);
  fireEvent.click(businessNavigation().getByRole('link', { name: 'PCN 变更' }));
  expect(sidebar.isConnected).toBe(false);
  expect(screen.queryByRole('navigation', { name: '内部领域导航' })).not.toBeInTheDocument();
  await act(async () => finishSession(response(session)));
  await screen.findByRole('navigation', { name: '内部领域导航' });
  expect(businessNavigation().getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
  expect(businessNavigation().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'true');
  expect(document.querySelector<HTMLElement>('.qms-primary-navigation')!.scrollTop).toBe(240);
});

it('restores the collapsed business rail after a verified route remount', async () => {
  mount('business', '/app/supplier-pcn');
  fireEvent.click(await screen.findByRole('button', { name: '收起业务菜单' }));
  const sidebar = document.querySelector<HTMLElement>('.qms-primary-navigation')!;
  sidebar.scrollTop = 90; fireEvent.scroll(sidebar);
  fireEvent.click(within(sidebar).getByRole('link', { name: '综合工作台' }));
  await act(async () => finishSession(response(session)));
  expect(await screen.findByRole('button', { name: '展开业务菜单' })).toBeInTheDocument();
  expect(document.querySelector<HTMLElement>('.qms-primary-navigation')!.scrollTop).toBe(90);
});

it('restores console scroll after both gates without caching the old menu or a pending clamp', async () => {
  mount('console');
  await screen.findByText('Verified console page');
  const sidebar = document.querySelector<HTMLElement>('.qms-console-sidebar')!;
  sidebar.scrollTop = 220; fireEvent.scroll(sidebar);
  fireEvent.click(within(sidebar).getByRole('link', { name: '流程管理' }));
  expect(sidebar.isConnected).toBe(false);
  expect(screen.queryByRole('link', { name: '用户与任职' })).not.toBeInTheDocument();
  let finishContext!: (value: ConsoleContext) => void;
  getContext.mockReturnValueOnce(new Promise(resolve => { finishContext = resolve; }));
  await act(async () => finishSession(response(session)));
  await waitFor(() => expect(finishContext).toBeDefined());
  const pendingSidebar = document.querySelector<HTMLElement>('.qms-console-sidebar')!;
  expect(within(pendingSidebar).queryByRole('link', { name: '用户与任职' })).not.toBeInTheDocument();
  pendingSidebar.scrollTop = 0; fireEvent.scroll(pendingSidebar);
  await act(async () => finishContext(context));
  expect(await screen.findByText('Verified console page')).toBeInTheDocument();
  expect(document.querySelector<HTMLElement>('.qms-console-sidebar')!.scrollTop).toBe(220);
});

it('retains console collapse through a verified route remount', async () => {
  mount('console');
  await screen.findByText('Verified console page');
  fireEvent.click(screen.getByRole('button', { name: '折叠导航' }));
  fireEvent.click(within(document.querySelector<HTMLElement>('.qms-console-sidebar')!).getByRole('link', { name: '流程管理' }));
  await act(async () => finishSession(response(session)));
  await screen.findByText('Verified console page');
  expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
});

it('resets live business navigation after a batched session A to B to A transition', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:a:actor');
  render(<MemoryRouter initialEntries={['/app/workbench']}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  fireEvent.click(businessNavigation().getByRole('button', { name: '供应商质量' }));
  fireEvent.click(screen.getByRole('button', { name: '收起业务菜单' }));
  act(() => {
    useWorkTabsStore.getState().bindSession('INTERNAL:a:other');
    useWorkTabsStore.getState().bindSession('INTERNAL:a:actor');
  });
  expect(await screen.findByRole('button', { name: '收起业务菜单' })).toBeInTheDocument();
  expect(businessNavigation().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'false');
});

it.each(['dirty', 'busy'] as const)('keeps the real mobile navigation and scroll intact while %s blocks leaving', async kind => {
  const original = globalThis.AbortController;
  globalThis.AbortController = function () { return transferableAbortController(); } as unknown as typeof AbortController;
  const router = createMemoryRouter([{ path: '/app/*', element: <AuthenticatedRoute accountType="INTERNAL"><InternalLayout /></AuthenticatedRoute> }], { initialEntries: ['/app/workbench'] });
  try {
    render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: kind === 'dirty' ? 'Toggle dirty' : 'Toggle busy' }));
    const sidebar = document.querySelector<HTMLElement>('.qms-primary-navigation')!;
    sidebar.scrollTop = 240; fireEvent.scroll(sidebar);
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    const drawer = within(screen.getByRole('dialog', { name: '业务导航' }));
    fireEvent.click(drawer.getByRole('button', { name: '供应商质量' }));
    fireEvent.click(drawer.getByRole('link', { name: 'PCN 变更' }));
    expect(router.state.location.pathname).toBe('/app/workbench');
    expect(screen.getByRole('dialog', { name: '业务导航' })).toBeInTheDocument();
    expect(sidebar.scrollTop).toBe(240);
    if (kind === 'dirty') {
      const confirmation = within(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }));
      fireEvent.click(confirmation.getByRole('button', { name: '继续编辑' }));
      expect(router.state.location.pathname).toBe('/app/workbench');
      expect(screen.getByRole('dialog', { name: '业务导航' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
    }
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => typeof path === 'string' && path.endsWith('/auth/session'))).toHaveLength(1);
  } finally { router.dispose(); globalThis.AbortController = original; }
});
