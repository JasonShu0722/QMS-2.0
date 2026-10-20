import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { AccountCenterPage } from './AccountCenterPage';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
const userEvent = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
import { clearAccountAvatar } from './account-avatar-state';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AccountMenu } from './AccountMenu';
import type { components } from '@qms/contracts';

type HistoryItem = components['schemas']['AccountSessionHistoryItemDto'];
type HistoryPage = components['schemas']['AccountSessionHistoryPageDto'];
const session = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 's1', createdAt: '2026-09-18T00:00:00.000Z', expiresAt: '2026-09-18T08:00:00.000Z',
  revokedAt: null, isCurrent: true, lifetimeType: 'STANDARD', status: 'ACTIVE', ...overrides,
});
const history = (items: HistoryItem[] = [], page = 1, total = items.length): HistoryPage => ({ items, total, page, pageSize: 10 });

const api = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  getAccountOverview: vi.fn(),
  getMySignatureSummary: vi.fn(),
  getAccountSessions: vi.fn(),
  getAccountSessionHistory: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  revokeAccountSession: vi.fn(),
}));

vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), ...api }));

async function openSettings() {
  const trigger = screen.getByRole('button', { name: '个人信息设置' });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '个人信息设置' });
  await waitFor(() => expect(dialog).toBeVisible());
}

describe('account center', () => {
  beforeEach(() => {
    localStorage.clear(); document.documentElement.lang = 'zh-CN';
    // rc-component's fixed test IDs collide between settings, security and password dialogs.
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetAllMocks();
    api.getAccountOverview.mockResolvedValue({ organizationId: 'o1', assignments: [], effectiveRoles: [], permissions: [] });
    api.getMySignatureSummary.mockResolvedValue([]);
    api.getAccountSessionHistory.mockResolvedValue(history([session()]));
    api.getAccountProfile.mockResolvedValue({ fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null, id: 'u1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, avatarFileId: null, avatarVersion: 1, organization: { id: 'o1', code: 'internal', name: 'Internal' } });
    api.getAccountSessions.mockRejectedValue(new Error('The duplicate active-session read must be removed'));
  });
  afterEach(() => vi.unstubAllEnvs());

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
    await screen.findByText(/当前会话/);
    expect(api.getAccountSessionHistory).toHaveBeenCalledOnce();
    expect(api.getAccountSessions).not.toHaveBeenCalled();
    expect(screen.queryByText(/passwordHash|tokenHash/i)).toBeNull();
  });

  it('combines identity and security in two display regions without permanent editors', async () => {
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    const overview = within(screen.getByText('账号概览').closest('.ant-card') as HTMLElement);
    expect(overview.getByRole('region', { name: '身份资料' })).toBeVisible();
    expect(overview.getByRole('region', { name: '账号与授权' })).toBeVisible();
    expect(overview.queryByLabelText('选择头像')).not.toBeInTheDocument();
    expect(overview.queryByRole('textbox')).not.toBeInTheDocument();
    expect(overview.getByText('验证器未绑定')).toBeVisible();
    expect(overview.getByRole('button', { name: '个人信息设置' })).toBeVisible();
  });

  it('shows only one session region and only active non-current rows can be revoked', async () => {
    api.getAccountSessionHistory.mockResolvedValue(history([
      session(),
      session({ id: 'other', isCurrent: false, lifetimeType: 'REMEMBERED_ADMIN' }),
      session({ id: 'revoked', isCurrent: false, status: 'REVOKED', revokedAt: '2026-09-18T01:00:00.000Z' }),
      session({ id: 'expired', isCurrent: false, status: 'EXPIRED', lifetimeType: 'REMEMBERED_USER' }),
    ]));
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('管理员记住登录');
    expect(screen.getAllByRole('region', { name: '登录会话' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: '会话历史' })).not.toBeInTheDocument();
    expect(screen.queryByText('会话历史')).not.toBeInTheDocument();
    expect(document.querySelector('.qms-account-session-list')).not.toBeInTheDocument();
    const currentRow = screen.getByText(/当前会话/).closest('tr') as HTMLElement;
    expect(within(currentRow).queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    for (const label of ['已撤销', '已过期']) {
      const row = screen.getByText(label).closest('tr') as HTMLElement;
      expect(within(row).queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: '撤销' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(api.revokeAccountSession).toHaveBeenCalledWith('other'));
    expect(api.getAccountSessions).not.toHaveBeenCalled();
  });

  it('keeps pagination outside the locally scrolling body with a separate table header', async () => {
    api.getAccountSessionHistory.mockResolvedValue(history([session()], 1, 11));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText(/当前会话/);
    const region = screen.getByRole('region', { name: '登录会话' });
    const body = region.querySelector('.ant-table-body') as HTMLElement;
    expect(body).toHaveStyle({ maxHeight: '320px', overflowY: 'scroll', overflowX: 'auto' });
    expect(body.querySelector('table')).toHaveStyle({ width: '800px' });
    expect(region.querySelector('.ant-table-header')).toBeInTheDocument();
    const next = within(region).getByTitle('Next Page');
    expect(body).not.toContainElement(next);
    expect(next).toBeVisible();
  });

  it('offers the private JPEG/PNG avatar picker in the existing account page', async () => {
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await openSettings();
    expect(screen.getByLabelText('选择头像')).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(screen.getByText('仅本人可见，JPEG/PNG，最大 2 MiB。')).toBeVisible();
  });

  it('opens account security in place and preserves an edited profile', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ isAdministrator: false, mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17' }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<MemoryRouter initialEntries={['/app/account']}><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
    await openSettings();
      await userEvent.clear(screen.getByLabelText('邮箱'));
      await userEvent.type(screen.getByLabelText('邮箱'), 'draft@example.test');
      const trigger = screen.getByRole('button', { name: '账号安全' });
      await userEvent.click(trigger);
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await waitFor(() => expect(dialog.getByText('验证器已绑定')).toBeVisible());
      expect(screen.queryByRole('link', { name: '账号安全' })).not.toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '账号安全' })).not.toBeInTheDocument());
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally { vi.unstubAllGlobals(); }
  });

  it('saves email with success feedback', async () => {
    api.updateAccountProfile.mockResolvedValue({ fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null, id: 'u1', username: 'alice', avatarFileId: null, avatarVersion: 1, organization: { name: 'Internal' } });
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await openSettings();
    await userEvent.clear(screen.getByLabelText('邮箱'));
    await userEvent.type(screen.getByLabelText('邮箱'), 'edited@example.test');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByText('资料已保存')).toBeInTheDocument();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ fullName: null, phone: null, email: 'edited@example.test', expectedProfileVersion: 1 }, expect.any(String));
  });

  it('refreshes security status on close without overwriting an email draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5 }), { headers: { 'content-type': 'application/json' } })));
    try {
      render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
    await openSettings();
      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
      api.getAccountProfile.mockResolvedValue({ ...await api.getAccountProfile.mock.results[0].value, mfaEnabled: true });
      await userEvent.click(screen.getByRole('button', { name: '账号安全' }));
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await dialog.findByText('验证器已绑定');
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '账号安全' })).not.toBeInTheDocument());
      expect(await screen.findByText('验证器已绑定')).toBeVisible();
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
    } finally { vi.unstubAllGlobals(); }
  });

  // 多弹窗交互在 JSDOM 中需要更长执行时间，仅为本组用例放宽时限。
  it('refreshes the single session list after menu password change without overwriting an email draft', async () => {
    api.changeAccountPassword.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/app/account']}><AccountMenu /><AccountCenterPage /></MemoryRouter>);
    await screen.findByRole('button', { name: '个人菜单 · alice' });
    await openSettings();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
    await userEvent.click(screen.getByRole('button', { name: '个人菜单 · alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '修改密码' }));
    fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPassword123!' } });
    await userEvent.click(within(screen.getByRole('dialog', { name: '修改密码' })).getByRole('button', { name: '修改密码' }));
    await screen.findByText('密码已修改，其他会话已撤销');
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    expect(api.getAccountSessions).not.toHaveBeenCalled();
    expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
  }, 30_000);

  it('does not show an empty session list when a newer refresh fails before the initial read completes', async () => {
    let resolveInitial!: (sessions: HistoryPage) => void;
    api.getAccountSessionHistory.mockReturnValueOnce(new Promise(resolve => { resolveInitial = resolve; })).mockRejectedValueOnce(new Error('refresh offline'));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await act(async () => window.dispatchEvent(new Event('qms:account-sessions-changed')));
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    await act(async () => resolveInitial(history([session({ id: 'stale' })])));
    await screen.findByText('alice');
    expect(screen.getByText('请求失败，请重试')).toBeVisible();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
    expect(screen.queryByText(/当前会话/)).not.toBeInTheDocument();
  });

  // 以下两个多动作重试用例在 JSDOM 中需要更长执行时间，分别设置 30 秒局部时限。
  it('preserves an email draft when retrying failed security status refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5 }), { headers: { 'content-type': 'application/json' } })));
    try {
      render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
    await openSettings();
      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
      const nextProfile = { ...await api.getAccountProfile.mock.results[0].value, mfaEnabled: true };
      api.getAccountProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(nextProfile);
      await userEvent.click(screen.getByRole('button', { name: '账号安全' }));
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await dialog.findByText('验证器已绑定');
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '账号安全' })).not.toBeInTheDocument());
      await screen.findByText('请求失败，请重试');
      await userEvent.click(screen.getByRole('button', { name: /^重\s*试$/ }));
      expect(await screen.findByText('验证器已绑定')).toBeVisible();
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);

  it('retries a failed post-revoke read without repeating the write or clearing the draft', async () => {
    api.getAccountSessionHistory.mockResolvedValueOnce(history([session({ id: 'other', isCurrent: false })]))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(history([session({ id: 'other', isCurrent: false, status: 'REVOKED', revokedAt: '2026-09-18T01:00:00.000Z' })]));
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await openSettings();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
    await userEvent.click(screen.getByRole('button', { name: '撤销' }));
    await screen.findByText('请求失败，请重试');
    expect(screen.getByText('会话已撤销')).toBeVisible();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
    const profileReads = api.getAccountProfile.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^重\s*试$/ }));
    expect(await screen.findByText('已撤销')).toBeVisible();
    expect(screen.getByText('会话已撤销')).toBeVisible();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    expect(api.revokeAccountSession).toHaveBeenCalledOnce();
    expect(api.revokeAccountSession).toHaveBeenCalledWith('other');
    expect(api.getAccountProfile).toHaveBeenCalledTimes(profileReads);
    expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
  }, 30_000);

  // 多弹窗交互在 JSDOM 中需要更长执行时间，仅为本组用例放宽时限。
  it.each(['profile-first', 'security-first', 'retry-after-close'])('completes a profile retry overlapping security close (%s)', async order => {
    let finishRetry!: (value: unknown) => void;
    let finishSecurity!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5 }), { headers: { 'content-type': 'application/json' } })));
    try {
      render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
      await screen.findByText('alice');
      await openSettings();
      const initial = await api.getAccountProfile.mock.results[0].value;
      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'draft@example.test' } });
      api.updateAccountProfile.mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
      await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
      await screen.findByText('记录已被其他用户更新，请刷新后重试');
      const retry = new Promise(resolve => { finishRetry = resolve; });
      const security = new Promise(resolve => { finishSecurity = resolve; });
      api.getAccountProfile.mockReturnValueOnce(order === 'retry-after-close' ? security : retry)
        .mockReturnValueOnce(order === 'retry-after-close' ? retry : security);
      if (order !== 'retry-after-close') {
        await userEvent.click(screen.getByRole('button', { name: '读取最新资料基线' }));
        expect(screen.getByLabelText('邮箱')).toBeDisabled();
      }
      await userEvent.click(screen.getByRole('button', { name: '账号安全' }));
      const dialog = within(await screen.findByRole('dialog', { name: '账号安全' }));
      await dialog.findByText('验证器已绑定');
      await userEvent.click(dialog.getByRole('button', { name: '关闭账号安全' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '账号安全' })).not.toBeInTheDocument());
      if (order === 'retry-after-close') await userEvent.click(screen.getByRole('button', { name: '读取最新资料基线' }));
      expect(api.getAccountProfile).toHaveBeenCalledTimes(3);
      if (order !== 'profile-first') await act(async () => finishSecurity({ ...initial, mfaEnabled: true }));
      await act(async () => finishRetry({ ...initial, username: 'alice refreshed', mfaEnabled: false }));
      expect(screen.getByLabelText('邮箱')).toBeEnabled();
      expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled();
      expect(screen.getByText('alice')).toBeVisible();
      if (order === 'profile-first') await act(async () => finishSecurity({ ...initial, mfaEnabled: true }));
      expect(screen.getByText('验证器已绑定')).toBeVisible();
      expect(screen.getByLabelText('邮箱')).toHaveValue('draft@example.test');
      expect(screen.queryByRole('button', { name: /^重\s*试$/ })).not.toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);

  it('accepts an old password hash without rendering password fields', async () => {
    render(<MemoryRouter initialEntries={['/app/account#password']}><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '账号安全' })).toBeVisible();
  });

  it('paginates session history with status and lifetime labels', async () => {
    api.getAccountSessionHistory.mockImplementation(async (page: number) => history([session({
      id: `h${page}`, revokedAt: page === 1 ? '2026-09-18T01:00:00.000Z' : null, isCurrent: false,
      lifetimeType: page === 1 ? 'REMEMBERED_ADMIN' : 'REMEMBERED_USER', status: page === 1 ? 'REVOKED' : 'EXPIRED',
    })], page, 11));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(await screen.findByText('管理员记住登录')).toBeVisible();
    expect(screen.getByText('已撤销')).toBeVisible();
    await userEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenLastCalledWith(2));
    expect(await screen.findByText('用户记住登录')).toBeVisible();
    expect(screen.getByText('已过期')).toBeVisible();
  });

  it('refreshes the current history page after revoking a row on page two', async () => {
    api.getAccountSessionHistory.mockImplementation(async (page: number) => history([
      session({ id: `s${page}`, isCurrent: false, status: page === 1 ? 'EXPIRED' : 'ACTIVE' }),
    ], page, 11));
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('已过期');
    await userEvent.click(screen.getByTitle('Next Page'));
    const revoke = await screen.findByRole('button', { name: '撤销' });
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 's2', isCurrent: false, status: 'REVOKED', revokedAt: '2026-09-18T01:00:00.000Z' })], 2, 11));
    await userEvent.click(revoke);
    await screen.findByText('已撤销');
    expect(api.revokeAccountSession).toHaveBeenCalledWith('s2');
    expect(api.getAccountSessionHistory.mock.calls).toEqual([[1], [2], [2]]);
    expect(screen.getByTitle('2')).toHaveClass('ant-pagination-item-active');
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
  });

  it('ignores a superseded page response after a password-change refresh', async () => {
    let finishPage!: (value: HistoryPage) => void;
    api.getAccountSessionHistory.mockResolvedValueOnce(history([session()], 1, 11))
      .mockReturnValueOnce(new Promise(resolve => { finishPage = resolve; }))
      .mockResolvedValue(history([session({ id: 'latest', isCurrent: false, status: 'REVOKED', lifetimeType: 'REMEMBERED_USER' })], 2, 11));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText(/当前会话/);
    await userEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    await act(async () => window.dispatchEvent(new Event('qms:account-sessions-changed')));
    await screen.findByText('已撤销');
    await act(async () => finishPage(history([session({ id: 'old', isCurrent: false, status: 'EXPIRED', lifetimeType: 'REMEMBERED_ADMIN' })], 2, 11)));
    expect(screen.getByText('用户记住登录')).toBeVisible();
    expect(screen.queryByText('已过期')).not.toBeInTheDocument();
    expect(screen.queryByText('管理员记住登录')).not.toBeInTheDocument();
    expect(api.getAccountSessionHistory.mock.calls).toEqual([[1], [2], [2]]);
  });

  it('ignores an older refresh failure after a newer refresh succeeds', async () => {
    let rejectOlder!: (cause: unknown) => void;
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText(/当前会话/);
    api.getAccountSessionHistory.mockReturnValueOnce(new Promise((_, reject) => { rejectOlder = reject; }))
      .mockResolvedValue(history([session({ isCurrent: false, status: 'EXPIRED' })]));
    await act(async () => window.dispatchEvent(new Event('qms:account-sessions-changed')));
    await act(async () => window.dispatchEvent(new Event('qms:account-sessions-changed')));
    await screen.findByText('已过期');
    await act(async () => rejectOlder(new Error('stale offline')));
    expect(screen.queryByText('请求失败，请重试')).not.toBeInTheDocument();
    expect(screen.getByText('已过期')).toBeVisible();
  });

  it('synchronously prevents duplicate revokes and keeps the guard through the history refresh', async () => {
    let finishRevoke!: () => void;
    let finishRefresh!: (value: HistoryPage) => void;
    api.getAccountSessionHistory.mockResolvedValueOnce(history([
      session({ id: 'other', isCurrent: false }), session({ id: 'another', isCurrent: false }),
    ])).mockReturnValueOnce(new Promise(resolve => { finishRefresh = resolve; }));
    api.revokeAccountSession.mockReturnValue(new Promise<void>(resolve => { finishRevoke = resolve; }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    const buttons = await screen.findAllByRole('button', { name: '撤销' });
    act(() => { fireEvent.click(buttons[0]); fireEvent.click(buttons[0]); fireEvent.click(buttons[1]); });
    expect(api.revokeAccountSession).toHaveBeenCalledOnce();
    expect(api.revokeAccountSession).toHaveBeenCalledWith('other');
    expect(buttons[1]).toBeDisabled();
    await act(async () => finishRevoke());
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    for (const button of screen.queryAllByRole('button', { name: '撤销' })) expect(button).toBeDisabled();
    await act(async () => finishRefresh(history([session({ id: 'another', isCurrent: false })])));
    expect(await screen.findByRole('button', { name: '撤销' })).toBeEnabled();
  });

  it.each(['resolve', 'reject'])('ignores a late revoke %s after an account epoch change', async outcome => {
    let complete!: () => void;
    let reject!: (cause: unknown) => void;
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 'other', isCurrent: false })]));
    api.revokeAccountSession.mockReturnValue(new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await act(async () => clearAccountAvatar());
    await waitFor(() => expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2));
    await act(async () => { if (outcome === 'resolve') complete(); else reject(new Error('old account failure')); });
    expect(api.getAccountSessionHistory).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('会话已撤销')).not.toBeInTheDocument();
    expect(screen.queryByText('请求失败，请重试')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
  });

  it('removes the password-change listener and ignores a late revoke after unmount', async () => {
    let complete!: () => void;
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 'other', isCurrent: false })]));
    api.revokeAccountSession.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    const view = render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    view.unmount();
    await act(async () => { complete(); window.dispatchEvent(new Event('qms:account-sessions-changed')); });
    expect(api.getAccountSessionHistory).toHaveBeenCalledOnce();
  });

  it('distinguishes history loading, error retry, and empty history', async () => {
    let reject!: (error: unknown) => void;
    api.getAccountSessionHistory.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    expect(screen.getByLabelText('正在加载登录会话')).toBeVisible();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
    await act(async () => reject(new Error('private')));
    const sessions = within(screen.getByRole('region', { name: '登录会话' }));
    expect(sessions.getByText('请求失败，请重试')).toBeVisible();
    expect(sessions.queryByText('暂无会话')).not.toBeInTheDocument();
    api.getAccountSessionHistory.mockResolvedValue(history());
    await userEvent.click(sessions.getByRole('button', { name: /^重\s*试$/ }));
    expect(await sessions.findByText('暂无会话')).toBeVisible();
  });

  it('refreshes history after revoke without overwriting an email draft', async () => {
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 'other', isCurrent: false })]));
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    await openSettings();
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
      complete(history([session({ id: 'old', status: 'EXPIRED', isCurrent: false })]));
    });
    expect(screen.queryByText('old account')).not.toBeInTheDocument();
    expect(screen.queryByText('已过期')).not.toBeInTheDocument();
    clearAccountAvatar();
  });

  it('revokes another session with feedback', async () => {
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 'other', isCurrent: false })]));
    api.revokeAccountSession.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('会话已撤销')).toBeInTheDocument();
  });

  it.each(['profile', 'session'])('displays %s failure without success feedback', async (operation) => {
    api.getAccountSessionHistory.mockResolvedValue(history([session({ id: 'other', isCurrent: false })]));
    api.updateAccountProfile.mockRejectedValue(new Error('private'));
    api.changeAccountPassword.mockRejectedValue(new Error('private'));
    api.revokeAccountSession.mockRejectedValue(new Error('private'));
    render(<MemoryRouter><AccountCenterPage /></MemoryRouter>);
    await screen.findByText('alice');
    if (operation === 'profile') { await openSettings(); fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Draft' } }); }
    await userEvent.click(screen.getByRole('button', { name: operation === 'profile' ? '保存资料' : '撤销' }));
    expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText(/已保存|已修改|已撤销/)).not.toBeInTheDocument();
  });
});
