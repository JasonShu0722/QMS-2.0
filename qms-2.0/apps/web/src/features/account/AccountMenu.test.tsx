import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AccountMenu } from './AccountMenu';

const profile = { username: 'alice' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function Page({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const location = useLocation();
  return <output aria-label="current path">{location.pathname}{location.hash}</output>;
}
function mount(supplier = false, dirty = false) {
  return render(<MemoryRouter initialEntries={[supplier ? '/supplier/inbox' : '/app/workbench']}><LanguageProvider><UnsavedChangesProvider>
    <Routes><Route path="/login" element={<h1>Login</h1>} /><Route path="*" element={<><AccountMenu supplier={supplier} /><Page dirty={dirty} /></>} /></Routes>
  </UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
}
async function open() {
  const button = await screen.findByRole('button', { name: '个人菜单 · alice' });
  await userEvent.click(button);
  return button;
}
async function requestLogout() {
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
  return within(await screen.findByRole('dialog', { name: '确认退出登录？' }));
}
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); });
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('keeps personal settings and password in their own portal supplier=%s', async supplier => {
  vi.stubGlobal('fetch', vi.fn(async () => json(profile)));
  mount(supplier);
  const button = await open();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(within(button).getByText('A')).toBeVisible();
  await userEvent.click(screen.getByRole('menuitem', { name: '个人设置' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent(`${supplier ? '/supplier' : '/app'}/account`);
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: '修改密码' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent(`${supplier ? '/supplier' : '/app'}/account#password`);
});

it('opens by keyboard and restores trigger focus after Escape', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(profile)));
  mount();
  const button = await screen.findByRole('button', { name: '个人菜单 · alice' });
  button.focus(); await userEvent.keyboard('{Enter}');
  await screen.findByRole('menu');
  expect(button).toHaveAttribute('aria-expanded', 'true');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(button).toHaveFocus());
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

it('cancels logout without requesting csrf or logout and restores focus', async () => {
  const fetcher = vi.fn(async () => json(profile)); vi.stubGlobal('fetch', fetcher);
  mount();
  const dialog = await requestLogout();
  await userEvent.click(dialog.getByRole('button', { name: /取.?消/ }));
  expect(fetcher.mock.calls).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('button', { name: '个人菜单 · alice' })).toHaveFocus());
});

it('sends one csrf-protected logout while pending and clears session tabs only on success', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf-test' }) : path.endsWith('/logout') ? new Promise<Response>(resolve => { complete = resolve; }) : json(profile));
  vi.stubGlobal('fetch', fetcher);
  const store = useWorkTabsStore.getState(); store.bindSession('INTERNAL:org:alice'); store.openTab({ id: 'secret', title: 'Page', path: '/app/account' });
  mount();
  const dialog = await requestLogout(); const confirm = dialog.getByRole('button', { name: '退出登录' });
  await userEvent.dblClick(confirm);
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/logout'))).toHaveLength(1));
  expect(useWorkTabsStore.getState().tabs).toHaveLength(1);
  expect(dialog.getByRole('button', { name: /取.?消/ })).toBeDisabled();
  expect(fetcher.mock.calls.find(([path]) => path.endsWith('/logout'))).toEqual(['/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test' }) })]);
  await act(async () => complete(new Response(null, { status: 204 })));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeVisible();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(sessionStorage.getItem('qms:work-pages:v1')).toBeNull();
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
});

it('preserves the session and safe retry feedback when logout fails', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf-test' }) : path.endsWith('/logout') ? ++attempts === 1 ? json({ code: 'PRIVATE_ERROR', message: 'raw secret internals' }, 503) : new Response(null, { status: 204 }) : json(profile));
  vi.stubGlobal('fetch', fetcher);
  const store = useWorkTabsStore.getState(); store.bindSession('INTERNAL:org:alice'); store.openTab({ id: 'a', title: 'Page', path: '/app/account' });
  mount(); const dialog = await requestLogout();
  await userEvent.click(dialog.getByRole('button', { name: '退出登录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请求被拒绝，请检查权限和填写内容后重试');
  expect(screen.queryByText('raw secret internals')).not.toBeInTheDocument();
  expect(useWorkTabsStore.getState().tabs).toHaveLength(1);
  expect(sessionStorage.getItem('qms:work-pages:v1')).toContain('alice');
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/workbench');
  await userEvent.click(dialog.getByRole('button', { name: '退出登录' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeVisible();
});

it('honors the existing dirty guard before opening logout confirmation', async () => {
  const fetcher = vi.fn(async () => json(profile)); vi.stubGlobal('fetch', fetcher);
  mount(false, true); await open();
  await userEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
  expect(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '确认退出登录？' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(fetcher.mock.calls).toHaveLength(1);
});

it('guards settings navigation before discarding a dirty page', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(profile)));
  mount(false, true); await open();
  await userEvent.click(screen.getByRole('menuitem', { name: '个人设置' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/workbench');
  const dialog = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await userEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/account');
});

it('opens account security over a dirty page without navigating and restores menu focus', async () => {
  const fetcher = vi.fn(async (path: string) => json(path.endsWith('/security') ? { isAdministrator: false, mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17' } : profile));
  vi.stubGlobal('fetch', fetcher);
  mount(false, true); const trigger = await open();
  await userEvent.click(screen.getByRole('menuitem', { name: '账号安全' }));
  const dialog = await screen.findByRole('dialog', { name: '账号安全' });
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/workbench');
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  await within(dialog).findByText('验证器已绑定');
  await userEvent.click(within(dialog).getByRole('button', { name: '关闭账号安全' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '账号安全' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('keeps menu navigation and logout available when profile loading fails, with retry', async () => {
  const fetcher = vi.fn(async () => json({ code: 'PRIVATE_ERROR', message: 'private profile' }, 503)); vi.stubGlobal('fetch', fetcher);
  mount();
  await userEvent.click(screen.getByRole('button', { name: '个人菜单' }));
  expect(await screen.findByRole('menuitem', { name: '退出登录' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '个人设置' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '重新加载账号' })).toBeInTheDocument();
  expect(screen.queryByText('private profile')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: '重新加载账号' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
