import { useState } from 'react';
import { Modal } from 'antd';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConsoleLayout, useConsoleContext } from './ConsoleLayout';
import { getConsoleContext } from './console-api';
import type { ConsoleContext } from './console-navigation';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ApiError } from '../api/client';

vi.mock('./console-api', () => ({ getConsoleContext: vi.fn() }));
const request = vi.mocked(getConsoleContext);
// Native top-layer/inert behavior needs the separate real-browser acceptance.
Object.defineProperties(HTMLDialogElement.prototype, { showModal: { configurable: true, writable: true, value() {} }, close: { configurable: true, writable: true, value() {} } });
const organization = { id: 'a', name: 'Organization A', code: 'A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const context: ConsoleContext = { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false, modules: [{ key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: 'a', permissions: ['account:users:read'] }] };
function Editor() { const [draft, setDraft] = useState(''); return <Modal open title="private console editor"><input aria-label="console draft" value={draft} onChange={event => setDraft(event.target.value)} /></Modal>; }
function application() { return render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><Editor /></ConsoleLayout></MemoryRouter>); }
beforeEach(() => { request.mockReset(); useWorkTabsStore.getState().bindSession('INTERNAL:a:actor'); vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }); vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); }); });

it('rechecks console capability on focus without discarding a valid portal draft, including a retry after a network failure', async () => {
  let finish!: (value: ConsoleContext) => void;
  request.mockResolvedValueOnce(context).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(context);
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'console secret' } });
  fireEvent.focus(window); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  expect(screen.getByLabelText('console draft')).toHaveValue('console secret');
  await act(async () => finish(context));
  expect(await screen.findByRole('textbox')).toHaveValue('console secret');
  fireEvent.focus(window);
  expect(await screen.findByText('无法验证管理权限，请重试')).toBeVisible();
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('textbox')).toHaveValue('console secret');
});

it('does not erase another window draft on a resource-denial recheck, but removes it when the server denies access', async () => {
  request.mockResolvedValue(context);
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'keep on unrelated refusal' } });
  act(() => publishSessionSignal('revalidate'));
  expect(await screen.findByRole('textbox')).toHaveValue('keep on unrelated refusal');
  request.mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403));
  fireEvent.focus(window);
  expect(await screen.findByText('管理访问已失效或无权限')).toBeInTheDocument();
  expect(screen.queryByLabelText('console draft')).not.toBeInTheDocument();
});

it('does not let a pre-focus callback deny a newer successfully verified scope', async () => {
  let controls!: ReturnType<typeof useConsoleContext>;
  function Page() { controls = useConsoleContext(); return <p>allowed console</p>; }
  request.mockResolvedValue(context);
  render(<MemoryRouter initialEntries={['/console/users']}><ConsoleLayout><Page /></ConsoleLayout></MemoryRouter>);
  await screen.findByText('allowed console'); const old = controls;
  fireEvent.focus(window); await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await screen.findByText('allowed console');
  act(() => old.invalidate());
  expect(screen.getByText('allowed console')).toBeInTheDocument();
});

it('clears mounted draft state when the server reports a changed capability set', async () => {
  request.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, modules: [{ ...context.modules[0]!, permissions: ['account:users:read', 'account:users:write'] }] });
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'old capability draft' } });
  fireEvent.focus(window);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
});

it('does not steal a retained modal input focus when soft verification returns a fresh equivalent JSON object', async () => {
  request.mockImplementation(async () => structuredClone(context));
  application(); const input = await screen.findByRole('textbox');
  const focusHeading = vi.spyOn(screen.getByRole('heading', { level: 1 }), 'focus');
  input.focus(); expect(input).toHaveFocus();
  fireEvent.focus(window);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '会话安全验证' })).not.toBeInTheDocument());
  expect(focusHeading).not.toHaveBeenCalled();
  expect(input).toHaveFocus();
});
