import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { PasswordRecoveryPage } from './PasswordRecoveryPage';
import { ResetPasswordPage } from './ResetPasswordPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cases = [
  { name: 'administrator reset', Page: ResetPasswordPage, tab: undefined, path: '/api/v1/auth/password-reset/complete', fields: [['重置凭证', 'reset-id.temporary-code'], ['新密码', 'ReplacementPassword123!']] },
  { name: 'recovery request', Page: PasswordRecoveryPage, tab: undefined, path: '/api/v1/auth/password-recovery', fields: [['账号或邮箱', 'alice@example.test'], ['组织代码（选填）', 'example']] },
  { name: 'recovery completion', Page: PasswordRecoveryPage, tab: '使用邮件凭证', path: '/api/v1/auth/password-recovery/complete', fields: [['邮件凭证', 't'.repeat(43)], ['新密码', 'ReplacementPassword123!']] },
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount(testCase: typeof cases[number]) {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : (await response).clone());
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  const view = render(<MemoryRouter><testCase.Page /></MemoryRouter>);
  if (testCase.tab) await user.click(screen.getByRole('tab', { name: testCase.tab }));
  for (const [label, value] of testCase.fields) await user.type(screen.getByLabelText(label), value);
  const form = screen.getByLabelText(testCase.fields[0][0]).closest('form')!;
  return { user, view, form, fetcher, finish, writes: () => fetcher.mock.calls.filter(([path]) => path === testCase.path) };
}

it.each(cases)('$name freezes the submitted inputs while its request is pending', async testCase => {
  const { user, form, writes, finish } = await mount(testCase);
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
  for (const [label, value] of testCase.fields) {
    const input = screen.getByLabelText(label);
    expect(input).toBeDisabled();
    await user.type(input, 'changed');
    expect(input).toHaveValue(value);
  }
  await act(async () => finish(json({ code: 'AUTH_PASSWORD_RESET_INVALID' }, 400)));
});

it.each(cases)('$name sends only one write for repeated form submissions before completion', async testCase => {
  const { form, writes, finish } = await mount(testCase);
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => { fireEvent.submit(form); });
  await act(async () => finish(json({ code: 'AUTH_PASSWORD_RESET_INVALID' }, 400)));
  await screen.findByText('重置凭证无效、已使用或已过期');
  expect(writes()).toHaveLength(1);
});

it.each(cases)('$name retains failed inputs for retry and removes them when unmounted', async testCase => {
  const { form, writes, finish, view } = await mount(testCase);
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => finish(json({ code: 'AUTH_PASSWORD_RESET_INVALID' }, 400)));
  await screen.findByText('重置凭证无效、已使用或已过期');
  for (const [label, value] of testCase.fields) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(screen.getByLabelText(label)).toBeEnabled();
  }
  view.unmount();
  render(<MemoryRouter><testCase.Page /></MemoryRouter>);
  if (testCase.tab) await userEvent.click(screen.getByRole('tab', { name: testCase.tab }));
  for (const [label] of testCase.fields) expect(screen.getByLabelText(label)).toHaveValue('');
});
