import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { AccountCenterPage } from './AccountCenterPage';
import userEvent from '@testing-library/user-event';
import { clearAccountAvatar } from './account-avatar-state';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AccountMenu } from './AccountMenu';
import type { AccountSession } from '@qms/contracts';

const api = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  getAccountSessions: vi.fn(),
  getAccountSessionHistory: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  revokeAccountSession: vi.fn(),
}));

vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), ...api }));

describe('account center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAccountSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    api.getAccountProfile.mockResolvedValue({ id: 'u1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, avatarFileId: null, avatarVersion: 1, organization: { id: 'o1', code: 'internal', name: 'Internal' } });
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

  it('offers the private JPEG/PNG avatar picker in the existing account page', async () => {
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    expect(screen.getByLabelText('选择头像')).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(screen.getByText('仅本人可见，JPEG/PNG，最大 2 MiB。')).toBeVisible();
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
      await waitFor(() => expect(dialog.getByText('验证器已绑定')).toBeVisible());
      expect(screen.queryByRole('link', { name: '账号安全' })).not.toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally { vi.unstubAllGlobals(); }
  });

  it('saves email with success feedback', async () => {
    api.updateAccountProfile.mockResolvedValue({ id: 'u1', username: 'alice', avatarFileId: null, avatarVersion: 1, organization: { name: 'Internal' } });
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await userEvent.clear(screen.getByLabelText('邮箱'));
    await userEvent.type(screen.getByLabelText('邮箱'), 'edited@example.test');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByText('资料已保存')).toBeInTheDocument();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ email: 'edited@example.test' });
  });

  it('refreshes security status on close without overwriting an email draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5 }), { headers: { 'content-type': 'application/json' } })));
    try {
      render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
      api.getAccountProfile.mockResolvedValue({ ...await api.getAccountProfile.mock.results[0].value, mfaEnabled: true });
      await userEvent.click(screen.getByRole('button', { name: '账号安全' }));
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await dialog.findByText('验证器已绑定');
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByText('验证器已绑定')).toBeVisible();
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
    } finally { vi.unstubAllGlobals(); }
  });

  it('refreshes sessions and history after menu password change without overwriting an email draft', async () => {
    api.changeAccountPassword.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/app/account']}><AccountMenu /><AccountCenterPage /></MemoryRouter>);
    await screen.findByRole('button', { name: '个人菜单 · alice' });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
    await userEvent.click(screen.getByRole('button', { name: '个人菜单 · alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '修改密码' }));
    fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPassword123!' } });
    await userEvent.click(within(screen.getByRole('dialog', { name: '修改密码' })).getByRole('button', { name: '修改密码' }));
    await screen.findByText('密码已修改，其他会话已撤销');
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    expect(api.getAccountSessions).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
  });

  it('does not show an empty session list when a newer refresh fails before the initial read completes', async () => {
    let resolveInitial!: (sessions: AccountSession[]) => void;
    api.getAccountSessions.mockReturnValueOnce(new Promise(resolve => { resolveInitial = resolve; })).mockRejectedValueOnce(new Error('refresh offline'));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await act(async () => window.dispatchEvent(new Event('qms:account-sessions-changed')));
    await waitFor(() => expect(api.getAccountSessions).toHaveBeenCalledTimes(2));
    await act(async () => resolveInitial([{ id: 'stale', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: true }]));
    await screen.findByText('alice');
    expect(screen.getByText('请求失败，请重试')).toBeVisible();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
  });

  it('preserves an email draft when retrying failed security status refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5 }), { headers: { 'content-type': 'application/json' } })));
    try {
      render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
      const nextProfile = { ...await api.getAccountProfile.mock.results[0].value, mfaEnabled: true };
      api.getAccountProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(nextProfile);
      await userEvent.click(screen.getByRole('button', { name: '账号安全' }));
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await dialog.findByText('验证器已绑定');
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await screen.findByText('请求失败，请重试');
      await userEvent.click(screen.getByRole('button', { name: /^重\s*试$/ }));
      expect(await screen.findByText('验证器已绑定')).toBeVisible();
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
    } finally { vi.unstubAllGlobals(); }
  });

  it('retries a failed post-revoke read without repeating the write or clearing the draft', async () => {
    api.getAccountSessions.mockResolvedValueOnce([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    api.revokeAccountSession.mockResolvedValue(undefined);
    api.getAccountSessionHistory.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 }).mockResolvedValue({ items: [{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', revokedAt: '2026-09-18', isCurrent: false, lifetimeType: 'STANDARD', status: 'REVOKED' }], total: 1, page: 1, pageSize: 10 });
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
    await userEvent.click(screen.getByRole('button', { name: '撤销' }));
    await screen.findByText('请求失败，请重试');
    expect(await screen.findByText('已撤销')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^重\s*试$/ }));
    expect(await screen.findByText('暂无会话')).toBeVisible();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    expect(api.revokeAccountSession).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
  });

  it('accepts an old password hash without rendering password fields', async () => {
    render(<MemoryRouter initialEntries={['/app/account#password']}><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '账号安全' })).toBeVisible();
  });

  it('paginates session history with status and lifetime labels', async () => {
    api.getAccountSessionHistory.mockImplementation(async (page: number) => ({ items: [{ id: `h${page}`, createdAt: '2026-09-18', expiresAt: '2026-09-19', revokedAt: page === 1 ? '2026-09-18' : null, isCurrent: false, lifetimeType: page === 1 ? 'REMEMBERED_ADMIN' : 'REMEMBERED_USER', status: page === 1 ? 'REVOKED' : 'EXPIRED' }], total: 11, page, pageSize: 10 }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(await screen.findByText('管理员记住登录')).toBeVisible();
    expect(screen.getByText('已撤销')).toBeVisible();
    await userEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenLastCalledWith(2));
    expect(await screen.findByText('用户记住登录')).toBeVisible();
    expect(screen.getByText('已过期')).toBeVisible();
  });

  it('distinguishes history loading, error retry, and empty history', async () => {
    let reject!: (error: unknown) => void;
    api.getAccountSessionHistory.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(screen.getByLabelText('正在加载会话历史')).toBeVisible();
    expect(screen.queryByText('暂无会话历史')).not.toBeInTheDocument();
    await act(async () => reject(new Error('private')));
    const history = within(screen.getByRole('region', { name: '会话历史' }));
    expect(history.getByText('请求失败，请重试')).toBeVisible();
    expect(history.queryByText('暂无会话历史')).not.toBeInTheDocument();
    await userEvent.click(history.getByRole('button', { name: /^重\s*试$/ }));
    expect(await history.findByText('暂无会话历史')).toBeVisible();
  });

  it('refreshes history after revoke without overwriting an email draft', async () => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await userEvent.clear(screen.getByLabelText('邮箱'));
    await userEvent.type(screen.getByLabelText('邮箱'), 'draft@example.test');
    await userEvent.click(screen.getByRole('button', { name: '撤销' }));
    await screen.findByText('会话已撤销');
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
  });

  it('ignores stale profile and history after an account change', async () => {
    let complete!: (value: unknown) => void;
    let completeProfile!: (value: unknown) => void;
    api.getAccountProfile.mockReturnValueOnce(new Promise(resolve => { completeProfile = resolve; }));
    api.getAccountSessionHistory.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await act(async () => { useWorkTabsStore.getState().bindSession('INTERNAL:o2:u2'); });
    await screen.findByText('alice');
    await act(async () => {
      completeProfile({ id: 'old-user', username: 'old account', organization: { name: 'Old' } });
      complete({ items: [{ id: 'old', createdAt: '2026-01-01', expiresAt: '2026-01-02', isCurrent: false, lifetimeType: 'STANDARD', status: 'EXPIRED' }], total: 1, page: 1, pageSize: 10 });
    });
    expect(screen.queryByText('old account')).not.toBeInTheDocument();
    expect(screen.queryByText('已过期')).not.toBeInTheDocument();
    clearAccountAvatar();
  });

  it('revokes another session with feedback', async () => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('会话已撤销')).toBeInTheDocument();
  });

  it.each(['profile', 'session'])('displays %s failure without success feedback', async (operation) => {
    api.getAccountSessions.mockResolvedValue([{ id: 'other', createdAt: '2026-09-18', expiresAt: '2026-09-19', isCurrent: false }]);
    api.updateAccountProfile.mockRejectedValue(new Error('private'));
    api.changeAccountPassword.mockRejectedValue(new Error('private'));
    api.revokeAccountSession.mockRejectedValue(new Error('private'));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await userEvent.click(screen.getByRole('button', { name: operation === 'profile' ? '保存资料' : '撤销' }));
    expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText(/已保存|已修改|已撤销/)).not.toBeInTheDocument();
  });
});
