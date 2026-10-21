import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { ReauthenticationProvider } from './ReauthenticationProvider';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function pendingReauthentication() {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' })
    : path.endsWith('/reauthenticate') ? (await response).clone() : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<ReauthenticationProvider><span>Application</span></ReauthenticationProvider>);
  const resolved = vi.fn();
  const rejected = vi.fn();
  const operation = apiRequest('/api/v1/test/guarded', { method: 'POST', body: '{}' }).then(resolved, rejected);
  const dialog = await screen.findByRole('dialog', { name: '重新验证身份' });
  const content = within(dialog);
  fireEvent.change(content.getByLabelText('当前密码'), { target: { value: 'only-in-memory-password' } });
  fireEvent.change(content.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  const form = content.getByLabelText('当前密码').closest('form')!;
  return { view, dialog, content, form, finish, operation, rejected, resolved, writes: () => fetcher.mock.calls.filter(([path]) => path.endsWith('/reauthenticate')) };
}

it('keeps reauthentication inputs frozen while pending and retains them after a safe failure', async () => {
  const { view, content, form, finish, operation, writes } = await pendingReauthentication();
  try {
    fireEvent.submit(form);
    await waitFor(() => expect(writes()).toHaveLength(1));
    for (const label of ['当前密码', '验证码或恢复码']) expect(content.getByLabelText(label)).toBeDisabled();
    await userEvent.type(content.getByLabelText('当前密码'), 'changed');
    expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
    await act(async () => finish(json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'private server details' }, 401)));
    expect(await content.findByText('用户名或密码错误')).toBeInTheDocument();
    expect(content.queryByText('private server details')).not.toBeInTheDocument();
    expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
    expect(content.getByLabelText('验证码或恢复码')).toHaveValue('123456');
    expect(content.getByLabelText('当前密码')).toBeEnabled();
  } finally {
    view.unmount();
    await operation;
  }
});

it('sends one reauthentication request for repeated form submissions while pending', async () => {
  const { view, form, finish, operation, writes } = await pendingReauthentication();
  try {
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    await act(async () => { fireEvent.submit(form); });
    await act(async () => finish(json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)));
    await screen.findByText('用户名或密码错误');
    expect(writes()).toHaveLength(1);
  } finally {
    view.unmount();
    await operation;
  }
});

it('blocks cancel and Escape while a reauthentication write is pending', async () => {
  const { view, dialog, content, form, finish, operation, rejected, resolved, writes } = await pendingReauthentication();
  try {
    fireEvent.submit(form);
    await waitFor(() => expect(writes()).toHaveLength(1));
    try {
      expect(content.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
      await userEvent.click(content.getByRole('button', { name: /取\s*消/ }));
      fireEvent.keyDown(content.getByLabelText('当前密码'), { key: 'Escape', code: 'Escape', keyCode: 27 });
      await act(async () => {});
      expect(dialog).toBeVisible();
      expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
      expect(rejected).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();
    } finally {
      await act(async () => finish(json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)));
    }
  } finally {
    view.unmount();
    await operation;
  }
});
