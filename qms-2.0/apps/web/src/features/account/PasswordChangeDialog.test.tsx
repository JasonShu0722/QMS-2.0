import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { AccountMenu } from './AccountMenu';
import { clearAccountAvatar } from './account-avatar-state';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const profile = { id: 'u1', username: 'alice', avatarFileId: null, avatarVersion: 1 };
async function open() {
  await userEvent.click(await screen.findByRole('button', { name: '个人菜单 · alice' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '修改密码' }));
  const dialog = await screen.findByRole('dialog', { name: '修改密码' });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}
async function discardConfirmation() {
  return within(await screen.findByRole('dialog', { name: '放弃密码修改？' }));
}
function fill() {
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'OldPassword123!' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPassword123!' } });
}
function mount() { return render(<MemoryRouter><LanguageProvider><AccountMenu /></LanguageProvider></MemoryRouter>); }
beforeEach(() => {
  localStorage.clear();
  // rc-component's fixed test ID collides in the nested modal Escape stack.
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(['AUTH_CURRENT_PASSWORD_INVALID', 'AUTH_PASSWORD_POLICY_INVALID'])('keeps secrets and safe feedback on %s', async code => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/password') ? json({ code, message: 'private internals' }, 400) : json(profile)));
  mount(); const dialog = await open(); fill();
  await userEvent.click(dialog.getByRole('button', { name: '修改密码' }));
  expect(await dialog.findByText(code === 'AUTH_CURRENT_PASSWORD_INVALID' ? '当前密码错误' : '密码不符合安全要求，请使用至少 12 位的强密码')).toBeVisible();
  expect(screen.queryByText('private internals')).not.toBeInTheDocument();
  expect(screen.getByLabelText('当前密码')).toHaveValue('OldPassword123!');
  expect(screen.getByLabelText('新密码')).toHaveValue('NewPassword123!');
});

it('blocks closing and duplicate submit while pending; succeeds, clears and restores focus', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/password') ? new Promise<Response>(resolve => { complete = resolve; }) : json(profile));
  vi.stubGlobal('fetch', fetcher); mount(); const dialog = await open(); fill();
  await userEvent.dblClick(dialog.getByRole('button', { name: '修改密码' }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/password'))).toHaveLength(1));
  expect(dialog.getByRole('button', { name: /取.?消/ })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('新密码'), { key: 'Escape', keyCode: 27 });
  expect(screen.getByRole('dialog', { name: '修改密码' })).toBeVisible();
  await act(async () => complete(new Response(null, { status: 204 })));
  expect(await screen.findByText('密码已修改，其他会话已撤销')).toBeVisible();
  await waitFor(() => expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: '个人菜单 · alice' })).toHaveFocus());
  await open();
  expect(screen.getByLabelText('新密码')).toHaveValue('');
});

it('asks before discarding secrets, supports continuing, and clears on reopen', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(profile))); mount(); let dialog = await open(); fill();
  await userEvent.click(dialog.getByRole('button', { name: /取.?消/ }));
  let confirm = await discardConfirmation();
  await userEvent.click(confirm.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByText('放弃密码修改？')).not.toBeInTheDocument());
  expect(screen.getByLabelText('新密码')).toHaveValue('NewPassword123!');
  fireEvent.keyDown(screen.getByLabelText('新密码'), { key: 'Escape', keyCode: 27 });
  confirm = await discardConfirmation();
  await userEvent.click(confirm.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument());
  dialog = await open();
  expect(dialog.getByLabelText('当前密码')).toHaveValue('');
});

it('ignores pending success after account invalidation or unmount', async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/password') ? new Promise<Response>(resolve => { complete = resolve; }) : json(profile)));
  const view = mount(); const dialog = await open(); fill();
  await userEvent.click(dialog.getByRole('button', { name: '修改密码' }));
  await waitFor(() => expect(complete).toBeDefined());
  clearAccountAvatar(); view.unmount();
  await act(async () => complete(new Response(null, { status: 204 })));
  expect(screen.queryByText('密码已修改，其他会话已撤销')).not.toBeInTheDocument();
});
