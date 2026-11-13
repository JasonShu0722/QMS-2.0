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
import { FEEDBACK_FORM_URL } from '../features/feedback/feedback-config';
import { UserAdministration } from '../features/admin/UserAdministration';

vi.mock('./console-api', () => ({ getConsoleContext: vi.fn() }));
const getContext = vi.mocked(getConsoleContext);
const a = { id: 'a', code: 'A', name: '组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const b = { ...a, id: 'b', code: 'B', name: '组织B' };
function context(target: string = a.id): ConsoleContext { return { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: a }, targetOrganization: target === a.id ? a : b, organizations: [a, b], hasPlatformAdministrator: false, modules: [
  { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target, permissions: ['account:users:read'] },
  { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: a.id, permissions: ['workflow:manage'] },
] }; }
beforeEach(() => { getContext.mockReset(); useWorkTabsStore.getState().bindSession('INTERNAL:a:actor'); localStorage.clear(); });
function Page({ dirty = false }: { dirty?: boolean }) { const location = useLocation(); const { context } = useConsoleContext(); useUnsavedChanges(dirty); return <div>受保护内容<output aria-label="verified actor">{context.actor.id}</output><output aria-label="verified home">{context.actor.homeOrganization.name}</output><output aria-label="path">{location.pathname}{location.search}</output></div>; }
function renderLayout(path = '/console/users', dirty = false) { return render(<MemoryRouter initialEntries={[path]}><ConsoleLayout><Page dirty={dirty} /></ConsoleLayout></MemoryRouter>); }
function LedgerPreferenceProbe() {
  const [pageSize, setPageSize] = useLedgerPageSize('scope-probe');
  return <button onClick={() => setPageSize(50)}>记住页长 {pageSize}</button>;
}
it.each(['/console', '/console/users?organizationId=b'])('provides one shared feedback entry on %s without leaving the console draft', async path => {
  getContext.mockResolvedValue(context(path.includes('organizationId=b') ? 'b' : 'a'));
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    render(<MemoryRouter initialEntries={[path]}><ConsoleLayout><Page dirty /><input aria-label="feedback draft" defaultValue="unsaved" /></ConsoleLayout></MemoryRouter>);
    const draft = await screen.findByRole('textbox', { name: 'feedback draft' });
    fireEvent.change(draft, { target: { value: 'keep this draft' } });
    const buttons = screen.getAllByRole('button', { name: '需求反馈' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.closest('.qms-console-theme')).toHaveAttribute('data-console-theme', 'light');
    fireEvent.click(buttons[0]!);
    expect(open).toHaveBeenCalledExactlyOnceWith(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
    expect(screen.getByLabelText('path')).toHaveTextContent(path);
    expect(screen.getByRole('textbox', { name: 'feedback draft' })).toBe(draft);
    expect(draft).toHaveValue('keep this draft');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useWorkTabsStore.getState().tabs).toEqual([]);
  } finally { open.mockRestore(); }
});
it('silently resumes an unchanged console draft without resetting focus or menu scroll', async () => {
  let finish!: (value: ConsoleContext) => void;
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><input aria-label="console draft" defaultValue="unsaved" /></ConsoleLayout></MemoryRouter>);
  const draft = await screen.findByRole('textbox', { name: 'console draft' });
  const menu = screen.getByRole('navigation', { name: '管理导航' });
  menu.scrollTop = 123; fireEvent.scroll(menu); draft.focus();
  fireEvent.focus(window);
  await waitFor(() => expect(getContext).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('dialog', { name: '会话安全验证' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'console draft' })).toBe(draft);
  expect(draft).toHaveFocus(); expect(menu.scrollTop).toBe(123);
  await act(async () => finish(context()));
  expect(screen.getByRole('textbox', { name: 'console draft' })).toBe(draft);
  expect(draft).toHaveFocus(); expect(menu.scrollTop).toBe(123);
});

it('silently resumes a console network failure with an inline retry alert', async () => {
  getContext.mockResolvedValueOnce(context()).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(context());
  render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><input aria-label="console draft" defaultValue="unsaved" /></ConsoleLayout></MemoryRouter>);
  const draft = await screen.findByRole('textbox', { name: 'console draft' }); draft.focus();
  fireEvent.focus(window);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法验证管理权限，请重试');
  expect(screen.queryByRole('dialog', { name: '会话安全验证' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'console draft' })).toBe(draft); expect(draft).toHaveFocus();
  expect(screen.getByRole('alert').closest('.qms-console-state')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('textbox', { name: 'console draft' })).toBe(draft); expect(draft).toHaveFocus();
});
it('merges later resumes into the current console check without aborting it', async () => {
  let finish!: (value: ConsoleContext) => void;
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  renderLayout(); await screen.findByText('受保护内容'); vi.useFakeTimers();
  try {
    act(() => { window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(50); });
    expect(getContext).toHaveBeenCalledTimes(2);
    const signal = getContext.mock.calls[1]![1]!;
    act(() => { window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(50); });
    expect(getContext).toHaveBeenCalledTimes(2); expect(signal.aborted).toBe(false);
    await act(async () => finish(context()));
  } finally { vi.useRealTimers(); }
});
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
it('keeps one semantic focused home heading and the compact target selector without redundant identity facts', async () => {
  getContext.mockResolvedValue(context());
  renderLayout('/console');
  await screen.findByText('受保护内容');
  const main = screen.getByRole('main');
  const heading = within(main).getByRole('heading', { level: 1, name: '管理首页' });
  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.queryByRole('navigation', { name: '面包屑' })).not.toBeInTheDocument();
  expect(within(main).queryByText('QMS / 管理工作空间')).not.toBeInTheDocument();
  const target = within(screen.getByRole('banner')).getByRole('combobox', { name: '管理目标组织' });
  expect(target).toHaveValue('a');
  expect(screen.queryByLabelText('当前身份')).not.toBeInTheDocument();
  expect(screen.queryByText(/身份与资源范围/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('verified actor')).toHaveTextContent('actor');
  expect(screen.getByLabelText('verified home')).toHaveTextContent('组织A');
  getContext.mockResolvedValue(context('b'));
  fireEvent.change(target, { target: { value: 'b' } });
  await waitFor(() => expect(screen.getByLabelText('path')).toHaveTextContent('organizationId=b'));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '管理首页' })).toHaveFocus());
  expect(screen.getByRole('combobox', { name: '管理目标组织' })).toHaveValue('b');
});

it('removes the redundant identity block and keeps the target selector in the topbar', async () => {
  getContext.mockResolvedValue(context());
  renderLayout('/console');
  await screen.findByText('受保护内容');
  expect(screen.queryByText('身份与资源范围')).not.toBeInTheDocument();
  expect(within(screen.getByRole('banner')).getByRole('combobox', { name: '管理目标组织' })).toHaveValue('a');
  expect(within(screen.getByRole('main')).queryByRole('combobox', { name: '管理目标组织' })).not.toBeInTheDocument();
});

it('does not show a target organization selector for a session-home route', async () => {
  getContext.mockResolvedValue(context());
  renderLayout('/console/workflows');
  await screen.findByText('受保护内容');
  expect(screen.getByRole('banner').querySelector('[aria-label="管理目标组织"]')).toBeNull();
});
it('retains a real return link and heading focus on a deep workflow route', async () => {
  getContext.mockResolvedValue(context('b'));
  renderLayout('/console/workflows/12345678-1234-4234-8234-123456789abc/87654321-4321-4321-8321-123456789abc?organizationId=b');
  await screen.findByText('受保护内容');
  const breadcrumb = screen.getByRole('navigation', { name: '面包屑' });
  expect(within(breadcrumb).getByRole('link', { name: '管理控制台' })).toHaveAttribute('href', '/console?organizationId=b');
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '流程管理' })).toHaveFocus());
  expect(screen.getByLabelText('verified home')).toHaveTextContent('组织A');
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
  expect(screen.getByLabelText('verified actor')).toHaveTextContent('actor');
  expect(screen.getByLabelText('verified home')).toHaveTextContent('组织A');
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
  expect(screen.getByLabelText('verified actor')).toHaveTextContent(actor.id);
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
  expect(screen.queryByRole('combobox', { name: '管理目标组织' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('verified home')).toHaveTextContent('组织A');
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
  expect(screen.getByLabelText('verified actor')).toHaveTextContent('new-actor');
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
  expect(screen.getByLabelText('verified actor')).toHaveTextContent('actor');
  expect(screen.getByLabelText('verified actor')).not.toHaveTextContent('stale-sensitive-actor');
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
it.each([
  { width: 1440, top: '16px', inline: '28px', bottom: '28px' },
  { width: 1024, top: '16px', inline: '20px', bottom: '20px' },
  { width: 390, top: '12px', inline: '14px', bottom: '18px' },
])('keeps shared management content compact at $width px without changing the other page margins', async ({ width, top, inline, bottom }) => {
  getContext.mockResolvedValue(context());
  renderLayout();
  await screen.findByText('受保护内容');
  const content = screen.getByRole('main');
  const style = document.createElement('style');
  style.textContent = readFileSync('src/console/console.css', 'utf8');
  document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules).flatMap(rule => {
      if (rule.type !== CSSRule.MEDIA_RULE) return [rule];
      const media = rule as CSSMediaRule;
      const maxWidth = /^\(max-width: (\d+)px\)$/.exec(media.conditionText);
      return maxWidth && width <= Number(maxWidth[1]) ? Array.from(media.cssRules) : [];
    }).filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE && content.matches((rule as CSSStyleRule).selectorText));
    content.style.cssText = rules.map(rule => rule.style.cssText).join(' ');
    const computed = getComputedStyle(content);
    expect(computed.paddingTop).toBe(top);
    expect(computed.paddingLeft).toBe(inline);
    expect(computed.paddingRight).toBe(inline);
    expect(computed.paddingBottom).toBe(bottom);
    expect(content).toHaveClass('qms-console-content');
    expect(document.querySelector('.qms-console-topbar')).toBeInTheDocument();
  } finally { style.remove(); }
});
it('does not add a second top margin to the management verification state', () => {
  getContext.mockReturnValue(new Promise(() => {}));
  renderLayout();
  const state = screen.getByRole('status', { name: '验证管理权限中' });
  const style = document.createElement('style');
  style.textContent = readFileSync('src/console/console.css', 'utf8');
  document.head.append(style);
  try {
    expect(getComputedStyle(state).marginTop).toBe('0px');
    expect(getComputedStyle(state).marginBottom).toBe('32px');
  } finally { style.remove(); }
});
it.each(['users', 'governance'])('removes only the first management %s child spacing while keeping later and business content spaced', async kind => {
  getContext.mockResolvedValue(context());
  const organization = { ...a, permissions: ['account:users:read'] };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
  const view = render(<>
    <MemoryRouter initialEntries={['/console/users']}><ConsoleLayout>
      {kind === 'users' ? <UserAdministration organization={organization} organizations={[organization]} /> : <section className="governance-panel" aria-label="首项治理面板"><button>刷新治理数据</button></section>}
      <div className="admin-toolbar" data-testid="later-toolbar">后续工具栏</div>
      <section className="governance-panel" data-testid="later-panel">后续治理面板</section>
    </ConsoleLayout></MemoryRouter>
    <div className="qms-content" data-testid="business-content"><div className="admin-toolbar">业务工具栏</div><section className="governance-panel">业务治理面板</section></div>
  </>);
  const style = document.createElement('style');
  style.textContent = readFileSync('src/styles/global.css', 'utf8').replaceAll('var(--qms-section-gap)', '6px') + readFileSync('src/console/console.css', 'utf8');
  document.head.append(style);
  try {
    if (kind === 'users') await screen.findByLabelText('搜索用户');
    else await screen.findByRole('region', { name: '首项治理面板' });
    const content = screen.getByRole('main');
    const first = content.querySelector(kind === 'users' ? '.admin-toolbar' : '.governance-panel')!;
    expect(first.previousElementSibling).toHaveClass('sr-only');
    const computed = getComputedStyle(first);
    expect(kind === 'users' ? computed.marginTop : computed.paddingTop || computed.paddingBlockStart || computed.paddingBlock).toBe('0px');
    expect(kind === 'users' ? computed.marginBottom : computed.paddingBottom || computed.paddingBlockEnd || computed.paddingBlock).toBe('6px');
    const business = screen.getByTestId('business-content');
    for (const toolbar of [screen.getByTestId('later-toolbar'), business.querySelector('.admin-toolbar')!]) expect(getComputedStyle(toolbar).marginTop).toBe('6px');
    for (const panel of [screen.getByTestId('later-panel'), business.querySelector('.governance-panel')!]) {
      const spacing = getComputedStyle(panel);
      expect(spacing.paddingTop || spacing.paddingBlockStart || spacing.paddingBlock).toBe('6px');
    }
  } finally { view.unmount(); style.remove(); fetch.mockRestore(); }
});
