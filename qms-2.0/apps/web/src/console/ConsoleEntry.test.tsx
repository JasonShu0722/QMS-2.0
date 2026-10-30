import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountProfile, components } from '@qms/contracts';
import { ApiError } from '../api/client';
import { LanguageProvider } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { getConsoleContext } from './console-api';
import { ConsoleEntry } from './ConsoleEntry';
import { publishSessionSignal } from '../features/auth/session-invalidation';

vi.mock('./console-api', () => ({ getConsoleContext: vi.fn() }));
const getContext = vi.mocked(getConsoleContext);
type Context = components['schemas']['ConsoleContextDto'];
const organization = { id: 'o1', code: 'O', name: 'Organization', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const profile: AccountProfile = { id: 'u1', username: 'ordinary-name', fullName: null, phone: null, email: null, emailVerifiedAt: null, profileVersion: 1, avatarFileId: null, avatarVersion: 1, mfaEnabled: false, status: 'ACTIVE', accountType: 'INTERNAL', organization };
function context(key: Context['modules'][number]['key'] = 'workflows'): Context {
  return { actor: { id: profile.id, accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false, modules: [{ key, scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: organization.id, permissions: key === 'workflows' ? ['workflow:manage'] : ['account:users:read'] }] };
}
function deferred() {
  let resolve!: (value: Context) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Context>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  getContext.mockReset();
  localStorage.clear(); document.documentElement.lang = 'zh-CN';
  useWorkTabsStore.getState().bindSession('INTERNAL:o1:u1');
});

it.each(['workflows', 'users', 'organizations', 'audit', 'outbox'] as const)('offers the new-window entry for a real %s capability without inferring an administrator role', async key => {
  getContext.mockResolvedValue(context(key));
  render(<ConsoleEntry profile={profile} />);
  const entry = await screen.findByRole('link', { name: '管理控制台' });
  expect(entry).toHaveAttribute('href', '/console');
  expect(entry).toHaveAttribute('target', '_blank');
  expect(entry).toHaveAttribute('rel', 'noopener noreferrer');
  expect(entry).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
  expect(screen.getByText('在新窗口打开（浏览器可能使用页签）')).toBeVisible();
  expect(getContext).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
});

it('accepts a server-selected cross-organization target without forcing the home organization', async () => {
  getContext.mockResolvedValue({ ...context('users'), targetOrganization: { ...organization, id: 'o2' } });
  render(<ConsoleEntry profile={profile} />);
  expect(await screen.findByRole('link', { name: '管理控制台' })).toBeVisible();
  expect(getContext.mock.calls[0]?.[0]).toBeUndefined();
});

it.each(['SUPPLIER', 'missing-session', 'wrong-session'] as const)('does not query context for %s', async kind => {
  if (kind === 'missing-session') useWorkTabsStore.getState().reset();
  if (kind === 'wrong-session') useWorkTabsStore.getState().bindSession('INTERNAL:o2:u2');
  render(<ConsoleEntry profile={kind === 'SUPPLIER' ? { ...profile, accountType: 'SUPPLIER' } : profile} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(getContext).not.toHaveBeenCalled();
});

it('shows loading instead of granting access before context resolves', async () => {
  const request = deferred(); getContext.mockReturnValue(request.promise);
  render(<ConsoleEntry profile={profile} />);
  expect(screen.getByRole('status')).toHaveTextContent('正在验证管理入口');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await act(async () => request.resolve(context()));
  expect(screen.getByRole('link', { name: '管理控制台' })).toBeVisible();
});

it.each([401, 403])('hides the entry on a real HTTP %s denial', async status => {
  getContext.mockRejectedValue(new ApiError({ code: 'DENIED', message: 'private response' }, status));
  render(<ConsoleEntry profile={profile} />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText('private response')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
});

it.each(['no-modules', 'other-actor', 'other-home', 'supplier-actor', 'unknown-module'] as const)('never grants access from %s context', async kind => {
  const value = context();
  if (kind === 'no-modules') { value.modules = []; value.hasPlatformAdministrator = true; }
  if (kind === 'other-actor') value.actor.id = 'u2';
  if (kind === 'other-home') value.actor.homeOrganization = { ...organization, id: 'o2' };
  if (kind === 'supplier-actor') value.actor.accountType = 'SUPPLIER' as Context['actor']['accountType'];
  if (kind === 'unknown-module') value.modules = [{ ...value.modules[0]!, key: 'unknown' as Context['modules'][number]['key'] }];
  getContext.mockResolvedValue(value);
  render(<ConsoleEntry profile={profile} />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('distinguishes a network failure from denial and retries with focus on the recovered entry', async () => {
  getContext.mockRejectedValueOnce(new Error('secret error')).mockResolvedValue(context());
  render(<ConsoleEntry profile={profile} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法验证管理入口，请重试');
  expect(screen.queryByText('无权限')).not.toBeInTheDocument();
  const retry = screen.getByRole('button', { name: '重试' });
  retry.focus(); fireEvent.click(retry);
  const entry = await screen.findByRole('link', { name: '管理控制台' });
  await waitFor(() => expect(entry).toHaveFocus());
  expect(getContext).toHaveBeenCalledTimes(2);
});

it('does not reuse a previous user result while the new user is being verified', async () => {
  const pending = deferred();
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(pending.promise);
  const view = render(<ConsoleEntry profile={profile} />);
  await screen.findByRole('link', { name: '管理控制台' });
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:o1:u2'));
  view.rerender(<ConsoleEntry profile={{ ...profile, id: 'u2' }} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await act(async () => pending.resolve(context()));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('aborts the obsolete StrictMode request and ignores its late result', async () => {
  const obsolete = deferred(); const current = deferred();
  getContext.mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><ConsoleEntry profile={profile} /></StrictMode>);
  expect(getContext).toHaveBeenCalledTimes(2);
  expect(getContext.mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () => obsolete.resolve(context()));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await act(async () => current.reject(new ApiError({ code: 'DENIED', message: 'denied' }, 403)));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'] as const)('rejects a late %s from the original session after a batched A to B to A transition', async outcome => {
  const obsolete = deferred(); const current = deferred();
  getContext.mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
  render(<ConsoleEntry profile={profile} />);
  act(() => {
    useWorkTabsStore.getState().bindSession('INTERNAL:o1:u2');
    useWorkTabsStore.getState().bindSession('INTERNAL:o1:u1');
  });
  expect(getContext.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(getContext).toHaveBeenCalledTimes(2);
  await act(async () => outcome === 'resolve' ? obsolete.resolve(context()) : obsolete.reject(new ApiError({ code: 'DENIED', message: 'denied' }, 403)));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
  await act(async () => current.resolve(context()));
  expect(screen.getByRole('link', { name: '管理控制台' })).toBeVisible();
});

it('aborts on unmount instead of completing an orphaned request', async () => {
  const pending = deferred(); getContext.mockReturnValue(pending.promise);
  const view = render(<ConsoleEntry profile={profile} />); view.unmount();
  expect(getContext.mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () => pending.resolve(context()));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('uses the current language without persisting authorization context', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  getContext.mockResolvedValue(context());
  render(<LanguageProvider><ConsoleEntry profile={profile} /></LanguageProvider>);
  expect(await screen.findByRole('link', { name: 'Management console' })).toBeVisible();
  expect(screen.getByText('Opens in a new window (your browser may use a tab)')).toBeVisible();
  expect(Object.keys(localStorage)).toEqual(['qms:locale:v1']);
});

it.each(['focus', 'visible', 'signal'] as const)('rechecks naturally expired entry capability on %s without remounting account settings', async trigger => {
  const pending = deferred();
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(pending.promise);
  render(<><input aria-label="account setting draft" defaultValue="unsaved setting" /><ConsoleEntry profile={profile} /></>);
  await screen.findByRole('link', { name: '管理控制台' });
  if (trigger === 'focus') fireEvent.focus(window);
  else if (trigger === 'visible') { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange')); }
  else act(() => publishSessionSignal('revalidate'));
  expect(getContext).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('link', { name: '管理控制台' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('account setting draft')).toHaveValue('unsaved setting');
  await act(async () => pending.resolve({ ...context(), modules: [] }));
  expect(screen.queryByRole('link', { name: '管理控制台' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('account setting draft')).toHaveValue('unsaved setting');
});

it('does not let an old entry response undo a newer hard-invalidation refusal', async () => {
  const old = deferred(); const fresh = deferred();
  getContext.mockResolvedValueOnce(context()).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  render(<ConsoleEntry profile={profile} />); await screen.findByRole('link', { name: '管理控制台' });
  fireEvent.focus(window);
  act(() => publishSessionSignal('invalidate'));
  expect(getContext).toHaveBeenCalledTimes(3);
  await act(async () => fresh.reject(new ApiError({ code: 'DENIED', message: 'denied' }, 403)));
  await act(async () => old.resolve(context()));
  expect(screen.queryByRole('link', { name: '管理控制台' })).not.toBeInTheDocument();
});
