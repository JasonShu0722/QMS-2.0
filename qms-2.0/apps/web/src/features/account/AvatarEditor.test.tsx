import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@qms/contracts';
import { AvatarEditor } from './AvatarEditor';
import { AccountAvatar } from './AccountAvatar';
import { accountAvatarEpoch, clearAccountAvatar, publishAccountAvatar } from './account-avatar-state';
import { ApiError } from '../../api/client';

const api = vi.hoisted(() => ({ getAccountProfile: vi.fn(), updateAccountAvatar: vi.fn(), createUploadAttempt: vi.fn(), readAttachment: vi.fn(), retryScanAttachment: vi.fn(), attachmentDownload: vi.fn() }));
vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), getAccountProfile: api.getAccountProfile, updateAccountAvatar: api.updateAccountAvatar }));
vi.mock('../attachments/attachments', () => api);
const profile: AccountProfile = { id: 'user-a', username: 'alice', email: null, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, avatarFileId: null, avatarVersion: 1, organization: { id: 'org-a', code: 'test', name: 'test' } };
const pending = { id: 'file-a', status: 'QUARANTINED', scanStatus: 'PENDING', version: 2 };
const clean = { ...pending, status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 };
beforeEach(() => {
  clearAccountAvatar(); vi.clearAllMocks();
  api.createUploadAttempt.mockReturnValue({ run: vi.fn(async (observe) => { observe(pending); return pending; }) });
  api.readAttachment.mockResolvedValue(clean);
  api.updateAccountAvatar.mockResolvedValue({ ...profile, avatarFileId: 'file-a', avatarVersion: 2 });
  api.attachmentDownload.mockResolvedValue('https://storage.test/private?signature=temporary');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png']), { status: 200 })));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:avatar-test'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); clearAccountAvatar(); vi.unstubAllGlobals(); });
function choose(file = new File(['png'], 'avatar.png', { type: 'image/png' })) { fireEvent.change(screen.getByLabelText('选择头像'), { target: { files: [file] } }); }

it('does not publish a pending image, sets only after CLEAN, then shares and removes the reference', async () => {
  const change = vi.fn();
  publishAccountAvatar(profile, accountAvatarEpoch());
  render(<><AvatarEditor profile={profile} onChange={change} /><AccountAvatar profile={profile} /></>);
  choose();
  expect(await screen.findByText('等待安全扫描')).toBeVisible();
  expect(api.updateAccountAvatar).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '设为头像' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('选择头像')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '刷新头像状态' }));
  await userEvent.click(await screen.findByRole('button', { name: '设为头像' }));
  await waitFor(() => expect(api.updateAccountAvatar).toHaveBeenCalledWith({ fileId: 'file-a', expectedVersion: 1 }, expect.any(String), expect.any(AbortSignal)));
  await waitFor(() => expect(document.querySelectorAll('img[src="blob:avatar-test"]')).toHaveLength(2));
  api.updateAccountAvatar.mockResolvedValueOnce({ ...profile, avatarVersion: 3 });
  await userEvent.click(screen.getByRole('button', { name: '移除头像' }));
  await waitFor(() => expect(api.updateAccountAvatar).toHaveBeenLastCalledWith({ fileId: null, expectedVersion: 2 }, expect.any(String), expect.any(AbortSignal)));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
  expect(api.attachmentDownload).toHaveBeenCalledWith('file-a');
});

it('rejects wrong type and oversized photos before creating any upload', async () => {
  render(<AvatarEditor profile={profile} onChange={vi.fn()} />);
  choose(new File(['not an image'], 'x.svg', { type: 'image/svg+xml' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请选择不超过 2 MiB 的 JPEG 或 PNG 图片');
  choose(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
  expect(api.createUploadAttempt).not.toHaveBeenCalled();
});

it('reuses the same upload attempt and retries a failed scan without publishing it', async () => {
  const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async (observe) => { observe({ ...pending, scanStatus: 'ERROR' }); });
  api.createUploadAttempt.mockReturnValue({ run });
  api.retryScanAttachment.mockResolvedValue(pending);
  render(<AvatarEditor profile={profile} onChange={vi.fn()} />);
  choose();
  await userEvent.click(await screen.findByRole('button', { name: '重试上传' }));
  expect(api.createUploadAttempt).toHaveBeenCalledOnce();
  await userEvent.click(await screen.findByRole('button', { name: '重试安全扫描' }));
  expect(await screen.findByText('等待安全扫描')).toBeVisible();
  expect(api.updateAccountAvatar).not.toHaveBeenCalled();
});

it('keeps the idempotency key and current avatar when setting fails, and prevents double submission', async () => {
  api.createUploadAttempt.mockReturnValue({ run: vi.fn(async (observe) => { observe(clean); }) });
  let reject!: (error: Error) => void;
  api.updateAccountAvatar.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
  render(<AvatarEditor profile={profile} onChange={vi.fn()} />);
  choose();
  const set = await screen.findByRole('button', { name: '设为头像' });
  await userEvent.dblClick(set);
  expect(api.updateAccountAvatar).toHaveBeenCalledOnce();
  await act(async () => reject(new Error('offline')));
  await userEvent.click(set);
  expect(api.updateAccountAvatar.mock.calls[0]![1]).toBe(api.updateAccountAvatar.mock.calls[1]![1]);
});

it('clears photos immediately on session change, revokes Blob URLs, and ignores an old download', async () => {
  let complete!: (url: string) => void;
  api.attachmentDownload.mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve; }));
  const first = { ...profile, avatarFileId: 'old-file' };
  publishAccountAvatar(first, accountAvatarEpoch());
  const view = render(<AccountAvatar profile={first} />);
  await waitFor(() => expect(api.attachmentDownload).toHaveBeenCalledOnce());
  const next = { ...profile, id: 'user-b', username: 'bob', avatarFileId: 'new-file' };
  act(() => { clearAccountAvatar(); publishAccountAvatar(next, accountAvatarEpoch()); });
  view.rerender(<AccountAvatar profile={next} />);
  await waitFor(() => expect(screen.getByRole('img', { name: '本人头像' })).toHaveAttribute('src', 'blob:avatar-test'));
  await act(async () => complete('https://storage.test/old-secret'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  act(() => clearAccountAvatar());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});

it('does not apply a previous account upload after switching users', async () => {
  let finish!: () => void;
  api.createUploadAttempt.mockReturnValue({ run: vi.fn((observe) => new Promise<void>((resolve) => { finish = () => { observe(clean); resolve(); }; })) });
  const change = vi.fn();
  const view = render(<AvatarEditor profile={profile} onChange={change} />);
  choose();
  await waitFor(() => expect(api.createUploadAttempt).toHaveBeenCalledOnce());
  const next = { ...profile, id: 'user-b', username: 'bob' };
  act(() => { clearAccountAvatar(); publishAccountAvatar(next, accountAvatarEpoch()); });
  view.rerender(<AvatarEditor profile={next} onChange={change} />);
  await act(async () => finish());
  expect(screen.queryByText('扫描通过，可设为头像')).not.toBeInTheDocument();
  expect(screen.getByLabelText('选择头像')).not.toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});

it('offers a safe image-load retry without putting a signed URL in the image element', async () => {
  const selected = { ...profile, avatarFileId: 'file-a' };
  publishAccountAvatar(selected, accountAvatarEpoch());
  api.attachmentDownload.mockRejectedValueOnce(new Error('offline'));
  render(<AccountAvatar profile={selected} size={64} />);
  await userEvent.click(await screen.findByRole('button', { name: '重试加载头像' }));
  await waitFor(() => expect(screen.getByRole('img', { name: '本人头像' })).toHaveAttribute('src', 'blob:avatar-test'));
  expect(document.body.innerHTML).not.toContain('signature=temporary');
});

it('reloads the account after a CAS conflict, retains the CLEAN candidate, and writes only after explicit retry', async () => {
  api.createUploadAttempt.mockReturnValue({ run: vi.fn(async (observe) => { observe(clean); }) });
  api.updateAccountAvatar.mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  api.updateAccountAvatar.mockResolvedValue({ ...profile, avatarFileId: 'file-a', avatarVersion: 5 });
  const change = vi.fn();
  const latest = { ...profile, avatarVersion: 4 };
  let reload!: (value: AccountProfile) => void;
  api.getAccountProfile.mockImplementationOnce(() => new Promise<AccountProfile>((resolve) => { reload = resolve; }));
  render(<AvatarEditor profile={profile} onChange={change} />);
  choose();
  await userEvent.click(await screen.findByRole('button', { name: '设为头像' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('记录已被其他用户更新，请刷新后重试');
  await userEvent.click(screen.getByRole('button', { name: '重新加载账号' }));
  expect(screen.getByRole('button', { name: '重新加载账号' })).toBeDisabled();
  expect(api.getAccountProfile).toHaveBeenCalledWith(expect.any(AbortSignal));
  await act(async () => reload(latest));
  expect(change).toHaveBeenCalledWith(latest);
  expect(api.updateAccountAvatar).toHaveBeenCalledOnce();
  expect(screen.getByText('扫描通过，可设为头像')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '设为头像' }));
  expect(api.updateAccountAvatar).toHaveBeenLastCalledWith({ fileId: 'file-a', expectedVersion: 4 }, expect.any(String), expect.any(AbortSignal));
  expect(api.updateAccountAvatar.mock.calls[0]![1]).not.toBe(api.updateAccountAvatar.mock.calls[1]![1]);
});
