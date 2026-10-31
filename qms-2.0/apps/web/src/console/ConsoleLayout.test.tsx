import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { useUnsavedChanges } from '../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ConsoleLayout, useConsoleContext } from './ConsoleLayout';
import { getConsoleContext } from './console-api';
import type { ConsoleContext } from './console-navigation';
import { useLedgerPageSize } from '../ui/ledger';

vi.mock('./console-api', () => ({ getConsoleContext: vi.fn() }));
const getContext = vi.mocked(getConsoleContext);
const a = { id: 'a', code: 'A', name: '组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const b = { ...a, id: 'b', code: 'B', name: '组织B' };
function context(target: string = a.id): ConsoleContext { return { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: a }, targetOrganization: target === a.id ? a : b, organizations: [a, b], hasPlatformAdministrator: false, modules: [
  { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target, permissions: ['account:users:read'] },
  { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: a.id, permissions: ['workflow:manage'] },
] }; }
beforeEach(() => { getContext.mockReset(); useWorkTabsStore.getState().bindSession('INTERNAL:a:actor'); localStorage.clear(); });
function Page({ dirty = false }: { dirty?: boolean }) { const location = useLocation(); useUnsavedChanges(dirty); return <div>受保护内容<output aria-label="path">{location.pathname}{location.search}</output></div>; }
function renderLayout(path = '/console/users', dirty = false) { return render(<MemoryRouter initialEntries={[path]}><ConsoleLayout><Page dirty={dirty} /></ConsoleLayout></MemoryRouter>); }
function LedgerPreferenceProbe() {
  const [pageSize, setPageSize] = useLedgerPageSize('scope-probe');
  return <button onClick={() => setPageSize(50)}>记住页长 {pageSize}</button>;
}
it('scopes ledger preferences to the verified console target rather than the actor home organization', async () => {
  getContext.mockResolvedValue(context('b'));
  render(<MemoryRouter initialEntries={['/console/users?organizationId=b']}><ConsoleLayout><LedgerPreferenceProbe /></ConsoleLayout></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '记住页长 20' }));
  const keys = Object.keys(localStorage).filter(key => key.startsWith('qms:ledger:v1:'));
  expect(keys).toEqual(['qms:ledger:v1:["INTERNAL:a:actor","b","console","scope-probe","pageSize"]']);
  expect(JSON.parse(localStorage.getItem(keys[0]!)!)).toMatchObject({ value: 50 });
});
it('scopes session-home console ledger preferences to the real resource organization', async () => {
  getContext.mockResolvedValue(context('b'));
  render(<MemoryRouter initialEntries={['/console/workflows?organizationId=b']}><ConsoleLayout><LedgerPreferenceProbe /></ConsoleLayout></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '记住页长 20' }));
  expect(Object.keys(localStorage).filter(key => key.startsWith('qms:ledger:v1:'))).toEqual(['qms:ledger:v1:["INTERNAL:a:actor","a","console","scope-probe","pageSize"]']);
});
it('keeps one focused home heading and the target selector while disclosing identity and resource facts on demand', async () => {
  getContext.mockResolvedValue(context());
  renderLayout('/console');
  await screen.findByText('受保护内容');
  const main = screen.getByRole('main');
  const heading = within(main).getByRole('heading', { level: 1, name: '管理首页' });
  expect(heading).toHaveFocus();
  expect(screen.queryByRole('navigation', { name: '面包屑' })).not.toBeInTheDocument();
  expect(within(main).queryByText('QMS / 管理工作空间')).not.toBeInTheDocument();
  const target = within(main).getByRole('combobox', { name: '管理目标组织' });
  expect(target).toHaveValue('a');
  const identity = screen.getByLabelText('当前身份');
  const details = identity.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(identity).not.toBeVisible();
  fireEvent.click(within(details!).getByText(/身份与资源范围/));
  expect(identity).toBeVisible();
  expect(identity).toHaveTextContent('actor');
  expect(screen.getByLabelText('会话所属组织')).toHaveTextContent('组织A (A)');
  expect(screen.getByLabelText('模块资源范围')).toHaveTextContent('组织A · 组织范围');
  getContext.mockResolvedValue(context('b'));
  fireEvent.change(target, { target: { value: 'b' } });
  await waitFor(() => expect(screen.getByLabelText('path')).toHaveTextContent('organizationId=b'));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '管理首页' })).toHaveFocus());
  expect(screen.getByRole('combobox', { name: '管理目标组织' })).toHaveValue('b');
});
it('retains a real return link and heading focus on a deep workflow route', async () => {
  getContext.mockResolvedValue(context('b'));
  renderLayout('/console/workflows/12345678-1234-4234-8234-123456789abc/87654321-4321-4321-8321-123456789abc?organizationId=b');
  await screen.findByText('受保护内容');
  const breadcrumb = screen.getByRole('navigation', { name: '面包屑' });
  expect(within(breadcrumb).getByRole('link', { name: '管理控制台' })).toHaveAttribute('href', '/console?organizationId=b');
  expect(screen.getByRole('heading', { level: 1, name: '流程管理' })).toHaveFocus();
  expect(screen.getByText('所属组织').parentElement).toHaveTextContent('组织A (A)');
});
it('renders semantic icons for every menu and reserves the gear for platform configuration', async () => {
  const permissions = ['supplier-quality:profiles:read', 'customer-quality:complaints:read', 'material-master:read', 'component-project:read', 'console:api:read', 'console:exchanges:read', 'console:services:read'];
  getContext.mockResolvedValue({ ...context(), modules: (['users', 'organizations', 'supplier-accounts', 'reconfiguration', 'problem-reconfiguration', 'master-data', 'configuration', 'workflows', 'audit', 'outbox', 'api-monitoring', 'data-exchanges', 'services'] as const).map(key => ({ key, scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'a', permissions })) });
  renderLayout('/console');
  await screen.findByText('受保护内容');
  const links = screen.getByRole('navigation', { name: '管理导航' }).querySelectorAll('a');
  expect(links).toHaveLength(17);
  links.forEach(link => {
    const icon = link.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '18');
    if (link.getAttribute('href') === '/console/configuration') expect(icon).toHaveClass('lucide-settings');
    else expect(icon).not.toHaveClass('lucide-settings');
  });
  expect(screen.getByRole('link', { name: '物料主数据' }).querySelector('svg')).toHaveClass('lucide-package');
  expect(screen.getByRole('link', { name: '组件项目映射' }).querySelector('svg')).toHaveClass('lucide-link2');
});
it('verifies scope before rendering real children and navigates without writing business tabs', async () => {
  let resolve!: (value: ConsoleContext) => void;
  getContext.mockReturnValue(new Promise(done => { resolve = done; }));
  renderLayout();
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  await act(async () => resolve(context()));
  expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  expect(screen.getByLabelText('当前身份')).toHaveTextContent('actor');
  expect(screen.getByLabelText('会话所属组织')).toHaveTextContent('组织A');
  getContext.mockResolvedValue(context());
  fireEvent.click(screen.getByRole('link', { name: '流程管理' }));
  expect(await screen.findByLabelText('path')).toHaveTextContent('/console/workflows');
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
it('verifies an uppercase target UUID against the same canonical context without writing business tabs', async () => {
  const home = { ...a, id: 'abcdef12-3456-4789-abcd-1234567890ab' };
  const target = { ...b, id: 'bcdef123-4567-4890-abcd-2345678901bc' };
  const actor = { id: 'cdef1234-5678-4901-abcd-3456789012cd', accountType: 'INTERNAL' as const, homeOrganization: home };
  const result: ConsoleContext = { actor, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: false, modules: [
    { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target.id, permissions: ['account:users:read'] },
  ] };
  useWorkTabsStore.getState().bindSession(`INTERNAL:${home.id}:${actor.id}`);
  let resolve!: (value: ConsoleContext) => void;
  getContext.mockReturnValue(new Promise(done => { resolve = done; }));
  renderLayout(`/console/users?organizationId=${target.id.toUpperCase()}`);
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  await act(async () => resolve(result));
  expect(getContext).toHaveBeenCalledWith(target.id, expect.any(AbortSignal));
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
  expect(screen.getByLabelText('当前身份')).toHaveTextContent(actor.id);
  expect(screen.getByRole('combobox', { name: '管理目标组织' })).toHaveValue(target.id);
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
it('denies unauthorized and unknown deep links instead of rendering restricted children', async () => {
  getContext.mockResolvedValue({ ...context(), modules: [context().modules[1]!] });
  const view = renderLayout('/console/users');
  expect(await screen.findByText('无权访问此管理模块')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  view.unmount();
  renderLayout('/console/workflows/bad/bad');
  expect(await screen.findByText('管理页面不存在')).toBeInTheDocument();
});
it('fixes session-home pages to their true organization, not the selected target', async () => {
  getContext.mockResolvedValue(context('b'));
  renderLayout('/console/workflows?organizationId=b');
  await screen.findByText('受保护内容');
  expect(screen.getByLabelText('模块资源范围')).toHaveTextContent('组织A');
  expect(screen.queryByRole('combobox', { name: '管理目标组织' })).not.toBeInTheDocument();
  expect(screen.getByText('所属组织').parentElement).toHaveTextContent('组织A (A)');
  expect(getContext).toHaveBeenCalledWith('b', expect.any(AbortSignal));
});
it('clears sensitive context on explicit target 403, and retries a network failure without home fallback', async () => {
  getContext.mockRejectedValueOnce(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'denied' }, 403)).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(context('b'));
  renderLayout('/console/users?organizationId=b');
  expect(await screen.findByText('管理访问已失效或无权限')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('无法验证管理权限，请重试')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  expect(getContext.mock.calls.every(call => call[0] === 'b')).toBe(true);
});
it('discards late responses after identity changes, including aborted requests that still resolve', async () => {
  let old!: (value: ConsoleContext) => void;
  getContext.mockReturnValueOnce(new Promise(done => { old = done; })).mockResolvedValueOnce({ ...context(), actor: { ...context().actor, id: 'new-actor' } });
  renderLayout();
  await act(async () => useWorkTabsStore.getState().bindSession('INTERNAL:a:new-actor'));
  await screen.findByText('受保护内容');
  await act(async () => old(context()));
  expect(screen.getByLabelText('当前身份')).toHaveTextContent('new-actor');
});
it('uses the existing unsaved guard for organization switching', async () => {
  getContext.mockImplementation(async target => context(target));
  renderLayout('/console/users', true);
  await screen.findByText('受保护内容');
  fireEvent.change(screen.getByRole('combobox', { name: '管理目标组织' }), { target: { value: 'b' } });
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/console/users');
  fireEvent.change(screen.getByRole('combobox', { name: '管理目标组织' }), { target: { value: 'b' } });
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByLabelText('path')).toHaveTextContent('organizationId=b'));
});
it('clears and rejects an old request across a batched A to B to A session transition', async () => {
  let old!: (value: ConsoleContext) => void;
  getContext.mockReturnValueOnce(new Promise(done => { old = done; })).mockResolvedValueOnce({ ...context(), organizations: [a] });
  renderLayout();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:a:other'); useWorkTabsStore.getState().bindSession('INTERNAL:a:actor'); });
  await act(async () => old({ ...context(), actor: { ...context().actor, id: 'stale-sensitive-actor' } }));
  await screen.findByText('受保护内容');
  expect(screen.getByLabelText('当前身份')).toHaveTextContent('actor');
  expect(screen.getByLabelText('当前身份')).not.toHaveTextContent('stale-sensitive-actor');
});
it('refuses a response for a different actor than the bound session', async () => {
  getContext.mockResolvedValue({ ...context(), actor: { ...context().actor, id: 'another' } });
  renderLayout();
  expect(await screen.findByText('管理访问已失效或无权限')).toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
});
it('uses the actual router blocker for ordinary navigation and does not double-prompt after discard', async () => {
  const OriginalController = globalThis.AbortController;
  globalThis.AbortController = function () { return transferableAbortController(); } as unknown as typeof AbortController;
  getContext.mockResolvedValue(context());
  const router = createMemoryRouter([{ path: '*', element: <ConsoleLayout><Page dirty /></ConsoleLayout> }], { initialEntries: ['/console/users'] });
  try {
    render(<RouterProvider router={router} />);
    await screen.findByText('受保护内容');
    await waitFor(() => {
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    });
    fireEvent.click(screen.getByRole('link', { name: '流程管理' }));
    await waitFor(() => expect([...router.state.blockers.values()].map(blocker => blocker.state)).toEqual(['blocked']));
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    expect(router.state.location.pathname).toBe('/console/users');
    fireEvent.click(screen.getByRole('link', { name: '流程管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/console/workflows'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  } finally { router.dispose(); globalThis.AbortController = OriginalController; }
});
it('invalidates synchronously to a retryable denied state, not a fake in-flight loader', async () => {
  function Child() { const { invalidate } = useConsoleContext(); return <button onClick={invalidate}>安全失效</button>; }
  getContext.mockResolvedValue(context());
  render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><Child /></ConsoleLayout></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '安全失效' }));
  expect(screen.getByText('管理访问已失效或无权限')).toBeInTheDocument();
  expect(screen.queryByLabelText('验证管理权限中')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  expect(getContext).toHaveBeenCalledTimes(1);
});
it.each(['target', 'path'] as const)('does not revive a previously verified scope after a %s A to B to A round trip', async kind => {
  const pending: { resolve: (value: ConsoleContext) => void; reject: (error: Error) => void }[] = [];
  getContext.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  function Navigation() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate(kind === 'target' ? '/console/users?organizationId=b' : '/console/workflows')}>前往B</button><button onClick={() => navigate(-1)}>回到A</button></>;
  }
  render(<MemoryRouter initialEntries={['/console/users?organizationId=a']}><Navigation /><ConsoleLayout><Page /></ConsoleLayout></MemoryRouter>);
  await act(async () => pending[0]!.resolve(context()));
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '前往B' }));
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '回到A' }));
  expect(pending).toHaveLength(3);
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '流程管理' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('验证管理权限中')).toBeInTheDocument();
  await act(async () => {
    if (kind === 'target') pending[1]!.resolve(context('b'));
    else pending[1]!.reject(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'old denied' }, 403));
  });
  expect(screen.queryByText('管理访问已失效或无权限')).not.toBeInTheDocument();
  expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  await act(async () => pending[2]!.resolve(context()));
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
});
it('keeps a fresh verification active when an obsolete page calls invalidate', async () => {
  let controls!: ReturnType<typeof useConsoleContext>;
  let resolve!: (value: ConsoleContext) => void;
  function Child() { controls = useConsoleContext(); return <Page />; }
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><Child /></ConsoleLayout></MemoryRouter>);
  await screen.findByText('受保护内容');
  const previous = controls;
  act(() => previous.refresh());
  act(() => previous.invalidate());
  act(() => previous.refresh());
  expect(getContext).toHaveBeenCalledTimes(2);
  await act(async () => resolve(context()));
  expect(screen.getByText('受保护内容')).toBeInTheDocument();
});
it('declares coarse-pointer desktop sidebar link targets of at least 44px, including collapsed links', async () => {
  getContext.mockResolvedValue(context());
  renderLayout();
  await screen.findByText('受保护内容');
  const style = document.createElement('style');
  style.textContent = readFileSync('src/console/console.css', 'utf8');
  document.head.append(style);
  try {
    const coarseRules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).conditionText.includes('(pointer: coarse)')).flatMap(rule => Array.from(rule.cssRules)).filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE && (rule as CSSStyleRule).selectorText.includes('.qms-console-sidebar'));
    expect(coarseRules.length).toBeGreaterThan(0);
    const verify = () => {
      const links = document.querySelectorAll('.qms-console-sidebar nav a');
      expect(links.length).toBeGreaterThan(0);
      links.forEach(link => expect(coarseRules.some(rule => link.matches(rule.selectorText) && Number.parseFloat(rule.style.getPropertyValue('min-height')) >= 44)).toBe(true));
    };
    verify();
    fireEvent.click(screen.getByRole('button', { name: '折叠导航' }));
    expect(document.querySelector('.qms-console-collapsed')).not.toBeNull();
    verify();
  } finally { style.remove(); }
});
