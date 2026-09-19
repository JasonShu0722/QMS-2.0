import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('loads profile and current session without exposing credential fields', async () => {
    render(<AccountCenterPage />);
    expect(await screen.findByText('alice')).toBeTruthy();
    expect(screen.getByText('Internal · 内部账号')).toBeTruthy();
    await waitFor(() => expect(api.getAccountSessions).toHaveBeenCalledOnce());
    expect(screen.queryByText(/passwordHash|tokenHash/i)).toBeNull();
  });

  it('saves email with success feedback', async () => {
    api.updateAccountProfile.mockResolvedValue({ username: 'alice', organization: { name: 'Internal' } });
    render(<AccountCenterPage />);
    await screen.findByText('alice');
    await userEvent.clear(screen.getByLabelText('邮箱'));
    await userEvent.type(screen.getByLabelText('邮箱'), 'edited@example.test');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByText('资料已保存')).toBeInTheDocument();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ email: 'edited@example.test' });
  });

  it('changes password and clears secrets after success', async () => {
    api.changeAccountPassword.mockResolvedValue(undefined);
    render(<AccountCenterPage />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText('当前密码'), 'OldPassword123!');
    await userEvent.type(screen.getByLabelText('新密码'), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByText('密码已修改，其他会话已撤销')).toBeInTheDocument();
    expect(screen.getByLabelText('新密码')).toHaveValue('');
  });

  it('revokes another session with feedback', async () => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<AccountCenterPage />);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('会话已撤销')).toBeInTheDocument();
  });

  it.each(['profile', 'password', 'session'])('displays %s failure without success feedback', async (operation) => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.updateAccountProfile.mockRejectedValue(new Error('private'));
    api.changeAccountPassword.mockRejectedValue(new Error('private'));
    api.revokeAccountSession.mockRejectedValue(new Error('private'));
    render(<AccountCenterPage />);
    await screen.findByText('alice');
    if (operation === 'password') {
      await userEvent.type(screen.getByLabelText('当前密码'), 'OldPassword123!');
      await userEvent.type(screen.getByLabelText('新密码'), 'NewPassword123!');
    }
    await userEvent.click(screen.getByRole('button', { name: operation === 'profile' ? '保存资料' : operation === 'password' ? '修改密码' : '撤销' }));
    expect(await screen.findByText(operation === 'profile' ? '账号信息保存失败' : operation === 'password' ? '密码修改失败' : '会话撤销失败')).toBeInTheDocument();
    expect(screen.queryByText(/已保存|已修改|已撤销/)).not.toBeInTheDocument();
  });
});
