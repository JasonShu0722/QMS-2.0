import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../App';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
it('retains a failed reset for retry and clears credentials on successful exchange', async () => {
  window.history.replaceState({}, '', '/reset-password');
  let fail = true;
  const fetcher = vi.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/csrf')
    ? new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } })
    : fail ? new Response(JSON.stringify({ code: 'AUTH_PASSWORD_RESET_INVALID', message: 'private' }), { status: 400, headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const credential = await screen.findByLabelText('重置凭证');
  await userEvent.type(credential, 'reset-id.temporary-code');
  await userEvent.type(screen.getByLabelText('新密码'), 'ReplacementPassword123!');
  await userEvent.click(screen.getByRole('button', { name: '重置密码' }));
  expect(await screen.findByText('重置凭证无效、已使用或已过期')).toBeInTheDocument();
  expect(credential).toHaveValue('reset-id.temporary-code');
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: '重置密码' }));
  expect(await screen.findByText('密码已重置，请重新登录')).toBeInTheDocument();
  expect(screen.getByLabelText('重置凭证')).toHaveValue('');
  expect(screen.getByLabelText('新密码')).toHaveValue('');
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }), body: JSON.stringify({ resetId: 'reset-id', temporaryCode: 'temporary-code', newPassword: 'ReplacementPassword123!' }) });
});
