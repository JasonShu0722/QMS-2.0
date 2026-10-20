import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AccountProfile, components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AccountCenterPage } from './AccountCenterPage';
import { clearAccountAvatar } from './account-avatar-state';
import { LanguageProvider } from '../../i18n/Language';

const api = vi.hoisted(() => ({ getAccountProfile: vi.fn(), getAccountOverview: vi.fn(), getMySignatureSummary: vi.fn(), registerMySignature: vi.fn(), revokeMySignature: vi.fn(), updateAccountProfile: vi.fn(), getAccountSessionHistory: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), ...api }));
const profile: AccountProfile = { id: 'u1', username: 'alice', fullName: null, phone: null, email: 'alice@example.test', emailVerifiedAt: null, profileVersion: 4, avatarFileId: null, avatarVersion: 1, mfaEnabled: false, status: 'ACTIVE', accountType: 'INTERNAL', organization: { id: 'o1', code: 'O', name: 'Organization' } };
const overview: components['schemas']['AccountOverviewDto'] = { organizationId: 'o1', assignments: [{ id: 'a1', startedAt: '2026-01-01T00:00:00Z', endedAt: null, department: { id: 'd1', code: 'D', name: 'Quality' }, position: { id: 'p1', code: 'P', name: 'Engineer' } }], effectiveRoles: [{ id: 'r1', code: 'R', name: 'Inspector', sources: [{ kind: 'DIRECT' }, { kind: 'POSITION', positionId: 'p1', positionName: 'Engineer', assignmentId: 'a1' }] }], permissions: ['session:home', 'e-signature:signatures:read'] };
beforeEach(() => {
  localStorage.clear(); document.documentElement.lang = 'zh-CN';
  // Match the existing password-dialog fixture: nested dialogs need distinct accessibility IDs.
  vi.stubEnv('NODE_ENV', 'development');
  vi.resetAllMocks(); clearAccountAvatar();
  api.getAccountProfile.mockResolvedValue(profile);
  api.getAccountOverview.mockResolvedValue(overview);
  api.getMySignatureSummary.mockResolvedValue([]);
  api.getAccountSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});
afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); });
function mount() { return render(<MemoryRouter><UnsavedChangesProvider><AccountCenterPage /></UnsavedChangesProvider></MemoryRouter>); }
async function settings() {
  await waitFor(() => expect(document.querySelector('.qms-account-settings')).not.toBeInTheDocument());
  const trigger = await screen.findByRole('button', { name: '个人信息设置' });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  const element = await screen.findByRole('dialog', { name: '个人信息设置' }, { timeout: 5000 });
  await waitFor(() => expect(element).toBeVisible());
  return within(element);
}

it('shows two display regions, assignments and authorization sources without permanent editors', async () => {
  mount();
  const identity = within(await screen.findByRole('region', { name: '身份资料' }));
  expect(identity.getByText('alice')).toBeVisible();
  expect(identity.getByText('Quality · Engineer')).toBeVisible();
  expect(screen.getByRole('region', { name: '账号与授权' })).toBeVisible();
  expect(screen.queryByLabelText('选择头像')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('角色与权限来源'));
  expect(screen.getByText('Inspector')).toBeVisible();
  expect(screen.getByText('直接分配')).toBeVisible();
  expect(screen.getByText('岗位继承 · Engineer')).toBeVisible();
});

function mountStrict() { return render(<StrictMode><MemoryRouter><UnsavedChangesProvider><AccountCenterPage /></UnsavedChangesProvider></MemoryRouter></StrictMode>); }

it.each(['INTERNAL', 'SUPPLIER'] as const)('prefills persisted personal fields in StrictMode for %s after save, reopen and page reload', async accountType => {
  const initial = { ...profile, accountType, fullName: 'Existing name', phone: '+1 234', email: 'existing@example.test' };
  const saved = { ...initial, fullName: 'Saved name', phone: '+44 567', email: 'saved@example.test', profileVersion: 5 };
  api.getAccountProfile.mockResolvedValue(initial);
  api.updateAccountProfile.mockResolvedValue(saved);
  const page = mountStrict();
  let dialog = await settings();
  expect(dialog.getByLabelText('姓名')).toHaveValue(initial.fullName);
  expect(dialog.getByLabelText('电话')).toHaveValue(initial.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(initial.email);
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: saved.fullName } });
  fireEvent.change(dialog.getByLabelText('电话'), { target: { value: saved.phone } });
  fireEvent.change(dialog.getByLabelText('邮箱'), { target: { value: saved.email } });
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await dialog.findByText('资料已保存');
  expect(api.updateAccountProfile.mock.calls[0][0]).toEqual({ fullName: saved.fullName, phone: saved.phone, email: saved.email, expectedProfileVersion: initial.profileVersion });
  await userEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  dialog = await settings();
  expect(dialog.getByLabelText('姓名')).toHaveValue(saved.fullName);
  expect(dialog.getByLabelText('电话')).toHaveValue(saved.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(saved.email);
  page.unmount();
  api.getAccountProfile.mockResolvedValue(saved);
  mountStrict();
  dialog = await settings();
  expect(dialog.getByLabelText('姓名')).toHaveValue(saved.fullName);
  expect(dialog.getByLabelText('电话')).toHaveValue(saved.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(saved.email);
}, 30000);

it.each(['INTERNAL', 'SUPPLIER'] as const)('discards personal drafts on real close in StrictMode for %s while clearing signature material', async accountType => {
  const initial = { ...profile, accountType, fullName: 'Existing name', phone: '+1 234', email: 'existing@example.test' };
  api.getAccountProfile.mockResolvedValue(initial);
  api.getAccountOverview.mockResolvedValue({ ...overview, permissions: [...overview.permissions, 'e-signature:signatures:write'] });
  mountStrict();
  let dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Unsaved name' } });
  fireEvent.change(dialog.getByLabelText('电话'), { target: { value: '+44 999' } });
  fireEvent.change(dialog.getByLabelText('邮箱'), { target: { value: 'unsaved@example.test' } });
  if (accountType === 'INTERNAL') {
    fireEvent.change(dialog.getByLabelText('签名标签'), { target: { value: 'Unsaved signature' } });
    fireEvent.change(dialog.getByLabelText('签名原文'), { target: { value: 'private signature material' } });
  }
  await userEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(dialog.getByLabelText('姓名')).toHaveValue('Unsaved name');
  if (accountType === 'INTERNAL') expect(dialog.getByLabelText('签名原文')).toHaveValue('private signature material');
  await userEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  dialog = await settings();
  expect(dialog.getByLabelText('姓名')).toHaveValue(initial.fullName);
  expect(dialog.getByLabelText('电话')).toHaveValue(initial.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(initial.email);
  if (accountType === 'INTERNAL') {
    expect(dialog.getByLabelText('签名标签')).toHaveValue('');
    expect(dialog.getByLabelText('签名原文')).toHaveValue('');
  } else expect(dialog.queryByLabelText('签名原文')).not.toBeInTheDocument();
  expect(api.updateAccountProfile).not.toHaveBeenCalled();
  expect(api.registerMySignature).not.toHaveBeenCalled();
}, 30000);
it('edits all personal fields with CAS and a stable key across an uncertain retry', async () => {
  api.updateAccountProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...profile, fullName: 'Alice', phone: '+1 123 ext 9', profileVersion: 5 });
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Alice' } });
  fireEvent.change(dialog.getByLabelText('电话'), { target: { value: '+1 123 ext 9' } });
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await dialog.findByText('请求失败，请重试');
  expect(dialog.getByLabelText('姓名')).toHaveValue('Alice');
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await dialog.findByText('资料已保存');
  expect(api.updateAccountProfile.mock.calls[0][0]).toEqual({ fullName: 'Alice', phone: '+1 123 ext 9', email: profile.email, expectedProfileVersion: 4 });
  expect(api.updateAccountProfile.mock.calls[0][1]).toEqual(expect.any(String));
  expect(api.updateAccountProfile.mock.calls[1][1]).toBe(api.updateAccountProfile.mock.calls[0][1]);
});

it('rebases only changed personal fields after a conflict without overwriting remote contacts', async () => {
  api.updateAccountProfile.mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409)).mockResolvedValue({ ...profile, fullName: 'Draft', profileVersion: 10 });
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
  expect(dialog.getByRole('button', { name: '保存资料' })).toBeDisabled();
  const remote = { ...profile, fullName: 'Remote', phone: '+44 123 ext 8', email: 'remote@example.test', profileVersion: 9 };
  let finish!: (value: AccountProfile) => void;
  api.getAccountProfile.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await userEvent.click(dialog.getByRole('button', { name: '读取最新资料基线' }));
  expect(dialog.getByLabelText('姓名')).toBeDisabled();
  expect(dialog.getByLabelText('电话')).toBeDisabled();
  expect(dialog.getByLabelText('邮箱')).toBeDisabled();
  await act(async () => finish(remote));
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存资料' })).toBeEnabled());
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
  expect(dialog.getByLabelText('电话')).toHaveValue(remote.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(remote.email);
  expect(api.updateAccountProfile).toHaveBeenCalledOnce();
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await waitFor(() => expect(api.updateAccountProfile).toHaveBeenCalledTimes(2));
  expect(api.updateAccountProfile.mock.calls[1][0]).toEqual({ fullName: 'Draft', phone: remote.phone, email: remote.email, expectedProfileVersion: 9 });
  expect(api.updateAccountProfile.mock.calls[1][1]).not.toBe(api.updateAccountProfile.mock.calls[0][1]);
});

it.each(['whitespace', 'matching remote'] as const)('normalizes personal rebase changes and dirty state for %s', async scenario => {
  api.updateAccountProfile.mockRejectedValue(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: ' Draft ' } });
  if (scenario === 'whitespace') fireEvent.change(dialog.getByLabelText('电话'), { target: { value: '   ' } });
  await userEvent.click(dialog.getByRole('button', { name: '保存资料' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  const remote = { ...profile, fullName: scenario === 'matching remote' ? 'Draft' : 'Remote', phone: '+44 999', profileVersion: 5 };
  api.getAccountProfile.mockResolvedValue(remote);
  await userEvent.click(dialog.getByRole('button', { name: '读取最新资料基线' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存资料' })).toBeEnabled());
  expect(dialog.getByLabelText('姓名')).toHaveValue(' Draft ');
  expect(dialog.getByLabelText('电话')).toHaveValue(remote.phone);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(scenario !== 'matching remote');
});

it.each([403, 500])('distinguishes signature summary failure %s and still allows profile editing', async status => {
  api.getMySignatureSummary.mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status));
  mount(); const dialog = await settings();
  expect(await dialog.findByText(status === 403 ? '签名不可用' : '签名摘要加载失败')).toBeVisible();
  expect(dialog.getByLabelText('姓名')).toBeEnabled();
  expect(dialog.queryByText('暂无签名')).not.toBeInTheDocument();
});

it('confirms closing a draft, preserves it on cancel and restores the settings trigger', async () => {
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  await userEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
  await userEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: '个人信息设置' })).toHaveFocus());
}, 30000);

it('discards the first StrictMode profile generation', async () => {
  let finish!: (value: AccountProfile) => void;
  api.getAccountProfile.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<StrictMode><MemoryRouter><AccountCenterPage /></MemoryRouter></StrictMode>);
  await screen.findByText('alice');
  await act(async () => finish({ ...profile, username: 'stale-user' }));
  expect(screen.queryByText('stale-user')).not.toBeInTheDocument();
});

it('keeps a pending profile write open, blocks repeat submits and drops the late response after account change', async () => {
  let finish!: (value: AccountProfile) => void;
  api.updateAccountProfile.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  const save = dialog.getByRole('button', { name: '保存资料' });
  act(() => { fireEvent.click(save); fireEvent.click(save); });
  await waitFor(() => expect(api.updateAccountProfile).toHaveBeenCalledOnce());
  expect(dialog.getByRole('button', { name: '关闭个人信息设置' })).toBeDisabled();
  await act(async () => clearAccountAvatar());
  await act(async () => finish({ ...profile, fullName: 'Old account late name', profileVersion: 5 }));
  expect(screen.queryByText('Old account late name')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
});
it('keeps supplier signature summary unavailable without reading administrative or signature endpoints', async () => {
  api.getAccountProfile.mockResolvedValue({ ...profile, accountType: 'SUPPLIER' });
  mount(); const dialog = await settings();
  expect(dialog.getByText('签名不可用')).toBeVisible();
  expect(api.getMySignatureSummary).not.toHaveBeenCalled();
});
it('does not invent authorization counts when the overview fails', async () => {
  api.getAccountOverview.mockRejectedValue(new Error('offline'));
  mount(); await screen.findByText('任职与授权加载失败');
  expect(screen.getByText('授权摘要不可用')).toBeVisible();
  expect(screen.queryByText(/有效角色.*0/)).not.toBeInTheDocument();
  const dialog = await settings(); expect(dialog.getByLabelText('姓名')).toBeEnabled();
});

it('registers with the original signature contract, retries with the same key and clears raw input on success', async () => {
  api.getAccountOverview.mockResolvedValue({ ...overview, permissions: [...overview.permissions, 'e-signature:signatures:write'] });
  api.registerMySignature.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  mount(); const dialog = await settings();
  fireEvent.change(dialog.getByLabelText('签名标签'), { target: { value: 'Approval' } });
  fireEvent.change(dialog.getByLabelText('签名原文'), { target: { value: 'private signature material' } });
  fireEvent.click(dialog.getByRole('button', { name: '登记签名' }));
  await dialog.findByText('请求失败，请重试');
  expect(dialog.getByLabelText('签名原文')).toHaveValue('private signature material');
  fireEvent.click(dialog.getByRole('button', { name: '登记签名' }));
  await waitFor(() => expect(dialog.getByLabelText('签名原文')).toHaveValue(''));
  expect(api.registerMySignature.mock.calls[0][0]).toEqual({ label: 'Approval', signatureData: 'private signature material' });
  expect(api.registerMySignature.mock.calls[1][1]).toBe(api.registerMySignature.mock.calls[0][1]);
  await waitFor(() => expect(api.getMySignatureSummary).toHaveBeenCalledTimes(2));
});

it('revokes using the displayed signature version, then explicitly refreshes a conflict without repeating the write', async () => {
  const item: components['schemas']['ESignatureSummaryDto'] = { id: 's1', label: 'Approval', status: 'ACTIVE', version: 3, createdAt: '2026-01-01T00:00:00Z', revokedAt: null };
  api.getAccountOverview.mockResolvedValue({ ...overview, permissions: [...overview.permissions, 'e-signature:signatures:write'] });
  api.getMySignatureSummary.mockResolvedValue([item]);
  api.revokeMySignature.mockRejectedValue(new ApiError({ code: 'E_SIGNATURE_CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  mount(); const dialog = await settings();
  fireEvent.click(await dialog.findByRole('button', { name: '撤销签名 Approval' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(api.revokeMySignature.mock.calls[0].slice(0, 2)).toEqual(['s1', { expectedVersion: 3 }]);
  expect(dialog.getByRole('button', { name: '撤销签名 Approval' })).toBeDisabled();
  api.getMySignatureSummary.mockResolvedValue([{ ...item, version: 4, status: 'REVOKED', revokedAt: '2026-02-01T00:00:00Z' }]);
  fireEvent.click(dialog.getByRole('button', { name: '刷新签名摘要' }));
  await dialog.findByText('已撤销');
  expect(api.revokeMySignature).toHaveBeenCalledOnce();
  expect(dialog.queryByRole('button', { name: '撤销签名 Approval' })).not.toBeInTheDocument();
});

it('clears signature material on close and account switch and never offers writes with read-only permission', async () => {
  mount(); let dialog = await settings();
  expect(dialog.queryByLabelText('签名原文')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  api.getAccountOverview.mockResolvedValue({ ...overview, permissions: [...overview.permissions, 'e-signature:signatures:write'] });
  await act(async () => clearAccountAvatar());
  dialog = await settings();
  fireEvent.change(dialog.getByLabelText('签名原文'), { target: { value: 'private signature material' } });
  fireEvent.click(dialog.getByRole('button', { name: '关闭个人信息设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  dialog = await settings();
  expect(dialog.getByLabelText('签名原文')).toHaveValue('');
  fireEvent.change(dialog.getByLabelText('签名原文'), { target: { value: 'other material' } });
  await act(async () => clearAccountAvatar());
  dialog = await settings();
  expect(dialog.getByLabelText('签名原文')).toHaveValue('');
}, 30000);

it('translates the current profile and signature settings scope in English while preserving supplied data', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  api.getAccountProfile.mockResolvedValue({ ...profile, fullName: 'Provided name' });
  api.getAccountOverview.mockResolvedValue({ ...overview, permissions: [...overview.permissions, 'e-signature:signatures:write'] });
  api.getMySignatureSummary.mockResolvedValue([{ id: 's1', label: 'Provided signature', status: 'REVOKED', version: 2, createdAt: '2026-01-01T00:00:00Z', revokedAt: '2026-02-01T00:00:00Z' }]);
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AccountCenterPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  expect(await screen.findAllByText('Provided name')).toHaveLength(2);
  expect(screen.getByRole('region', { name: 'Identity' })).toBeVisible();
  expect(screen.getByText('Quality · Engineer')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Personal information settings' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Personal information settings' }));
  expect(dialog.getByLabelText('Full name')).toHaveValue('Provided name');
  expect(dialog.getByLabelText('Phone')).toBeEnabled();
  expect(await dialog.findByText('Provided signature')).toBeInTheDocument();
  expect(dialog.getByText('Revoked')).toBeInTheDocument();
  expect(dialog.getByLabelText('Signature material')).toBeEnabled();
  expect(dialog.getByRole('button', { name: 'Register signature' })).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Refresh signature summary' })).toBeInTheDocument();
  expect(screen.getByRole('dialog').textContent).not.toMatch(/[\u3400-\u9fff]/);
}, 30000);
