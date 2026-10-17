import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { AccountCenterPage } from './AccountCenterPage';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  getAccountSessions: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  revokeAccountSession: vi.fn(),
}));

vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), ...api }));

describe('account center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAccountProfile.mockResolvedValue({ id: 'u1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organization: { id: 'o1', code: 'internal', name: 'Internal' } });
    api.getAccountSessions.mockResolvedValue([{ id: 's1', createdAt: '2026-09-18T00:00:00.000Z', expiresAt: '2026-09-18T08:00:00.000Z', revokedAt: null, isCurrent: true }]);
  });

  it('shows initial load failure with trace ID without implying an empty session list', async () => {
    api.getAccountProfile.mockRejectedValueOnce(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '请先登录', traceId: 'account-trace' }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(await screen.findByText('account-trace')).toBeInTheDocument();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
  });

  it('loads profile and current session without exposing credential fields', async () => {
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(await screen.findByText('alice')).toBeTruthy();
    expect(screen.getByText('Internal · 内部账号')).toBeTruthy();
    await waitFor(() => expect(api.getAccountSessions).toHaveBeenCalledOnce());
    expect(screen.queryByText(/passwordHash|tokenHash/i)).toBeNull();
  });

  it('opens account security in place and preserves an edited profile', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ isAdministrator: false, mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17' }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<MemoryRouter initialEntries={['/app/account']}><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
      await userEvent.clear(screen.getByLabelText('邮箱'));
      await userEvent.type(screen.getByLabelText('邮箱'), 'draft@example.test');
      const trigger = screen.getByRole('button', { name: '账号安全' });
      await userEvent.click(trigger);
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      expect(await dialog.findByText('验证器已绑定')).toBeVisible();
      expect(screen.queryByRole('link', { name: '账号安全' })).not.toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally { vi.unstubAllGlobals(); }
  });

  it('saves email with success feedback', async () => {
    api.updateAccountProfile.mockResolvedValue({ username: 'alice', organization: { name: 'Internal' } });
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await userEvent.clear(screen.getByLabelText('邮箱'));
    await userEvent.type(screen.getByLabelText('邮箱'), 'edited@example.test');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByText('资料已保存')).toBeInTheDocument();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ email: 'edited@example.test' });
  });

  it('changes password and clears secrets after success', async () => {
    api.changeAccountPassword.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText('当前密码'), 'OldPassword123!');
    await userEvent.type(screen.getByLabelText('新密码'), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByText('密码已修改，其他会话已撤销')).toBeInTheDocument();
    expect(screen.getByLabelText('新密码')).toHaveValue('');
  });

  it('focuses the password section after loading a password deep link', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<MemoryRouter initialEntries={['/app/account#password']}><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await waitFor(() => expect(document.getElementById('password')).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
  });

  it('revokes another session with feedback', async () => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('会话已撤销')).toBeInTheDocument();
  });

  it.each(['profile', 'password', 'session'])('displays %s failure without success feedback', async (operation) => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.updateAccountProfile.mockRejectedValue(new Error('private'));
    api.changeAccountPassword.mockRejectedValue(new Error('private'));
    api.revokeAccountSession.mockRejectedValue(new Error('private'));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    if (operation === 'password') {
      await userEvent.type(screen.getByLabelText('当前密码'), 'OldPassword123!');
      await userEvent.type(screen.getByLabelText('新密码'), 'NewPassword123!');
    }
    await userEvent.click(screen.getByRole('button', { name: operation === 'profile' ? '保存资料' : operation === 'password' ? '修改密码' : '撤销' }));
    expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText(/已保存|已修改|已撤销/)).not.toBeInTheDocument();
  });
});
