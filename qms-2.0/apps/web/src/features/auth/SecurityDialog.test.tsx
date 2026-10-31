import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { SecurityDialog } from './SecurityDialog';

const status = { isAdministrator: false, mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17' };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
function Harness() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return <><button onClick={() => setOpen(true)}>Open security</button><output>{location.pathname}</output><SecurityDialog open={open} onClose={() => setOpen(false)} /></>;
}
function mount() { render(<LanguageProvider><MemoryRouter initialEntries={['/app/objects/draft']}><Harness /></MemoryRouter></LanguageProvider>); }
async function open() { await userEvent.click(screen.getByRole('button', { name: 'Open security' })); return within(await screen.findByRole('dialog', { name: '账号安全' })); }
async function closeConfirmation() {
  // Ant Design uses the same title ID for every dialog in NODE_ENV=test.
  const title = await screen.findByText('关闭账号安全？');
  return within(title.closest('[role="dialog"]') as HTMLElement);
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('loads only while open, clears email credentials on close and refetches on reopening', async () => {
  const fetcher = vi.fn(async () => json({ ...status, emailVerifiedAt: null })); vi.stubGlobal('fetch', fetcher);
  mount(); expect(fetcher).not.toHaveBeenCalled();
  let dialog = await open();
  await userEvent.type(await dialog.findByLabelText('邮件凭证'), 's'.repeat(43));
  await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByDisplayValue('s'.repeat(43))).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open security' })).toHaveFocus());
  dialog = await open();
  expect(await dialog.findByLabelText('邮件凭证')).toHaveValue('');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText('/app/objects/draft')).toBeVisible();
});

it('blocks close during a server write and confirms before discarding recovery codes', async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/recovery-codes') ? new Promise<Response>(resolve => { complete = resolve; }) : json(status)));
  mount(); const dialog = await open();
  await userEvent.click(await dialog.findByRole('button', { name: '重新生成恢复码' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '关闭账号安全' })).toBeDisabled());
  fireEvent.keyDown(screen.getByRole('dialog', { name: '账号安全' }), { key: 'Escape', keyCode: 27 });
  expect(screen.getByRole('dialog', { name: '账号安全' })).toBeVisible();
  await act(async () => complete(json({ recoveryCodes: ['test-recovery-secret'] })));
  expect(await dialog.findByText('test-recovery-secret')).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
  const confirm = await closeConfirmation();
  await userEvent.click(confirm.getByRole('button', { name: '继续查看' }));
  expect(dialog.getByText('test-recovery-secret')).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
  await userEvent.click((await closeConfirmation()).getByRole('button', { name: '确认关闭' }));
  await waitFor(() => expect(screen.queryByText('test-recovery-secret')).not.toBeInTheDocument());
});

it('confirms before discarding enrollment and reopens with a fresh status', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/enrollment') ? json({ secret: 'TEST-ENROLLMENT', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-18T12:00:00Z' }) : json({ ...status, mfaEnabled: false })); vi.stubGlobal('fetch', fetcher);
  mount(); const dialog = await open();
  await userEvent.click(await dialog.findByRole('button', { name: '绑定验证器' }));
  await dialog.findByText('TEST-ENROLLMENT');
  await userEvent.type(dialog.getByLabelText('验证码或恢复码'), '123456');
  await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
  await userEvent.click((await closeConfirmation()).getByRole('button', { name: '确认关闭' }));
  await waitFor(() => expect(screen.queryByText('TEST-ENROLLMENT')).not.toBeInTheDocument());
  const reopened = await open();
  await reopened.findByRole('button', { name: '绑定验证器' });
  expect(reopened.queryByLabelText('验证码或恢复码')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/security'))).toHaveLength(2);
});

it('keeps the dialog open for status errors and retries without exposing details', async () => {
  let attempt = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++attempt === 1 ? json({ code: 'PRIVATE_ERROR', message: 'private status' }, 503) : json(status)));
  mount(); const dialog = await open();
  await waitFor(() => expect(dialog.getByText('请求被拒绝，请检查权限和填写内容后重试')).toBeVisible());
  expect(screen.queryByText('private status')).not.toBeInTheDocument();
  await userEvent.click(dialog.getByRole('button', { name: /^重\s*试$/ }));
  expect(await dialog.findByText('验证器已绑定')).toBeVisible();
});
