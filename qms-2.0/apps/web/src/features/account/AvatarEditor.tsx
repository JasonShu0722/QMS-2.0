import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import type { AccountProfile } from '@qms/contracts';
import { ApiError, getAccountProfile, safeAccountError, updateAccountAvatar } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { createUploadAttempt, readAttachment, retryScanAttachment, type Attachment } from '../attachments/attachments';
import { AccountAvatar } from './AccountAvatar';
import { accountAvatarEpoch, publishAccountAvatar, useAccountAvatar } from './account-avatar-state';

type AvatarEditorProps = { profile: AccountProfile; onChange: (profile: AccountProfile) => void; children?: ReactNode };

export function AvatarEditor({ profile, onChange, children }: AvatarEditorProps) {
  useAccountAvatar();
  return <AvatarEditorContent key={`${accountAvatarEpoch()}:${profile.id}`} profile={profile} onChange={onChange}>{children}</AvatarEditorContent>;
}

function AvatarEditorContent({ profile, onChange, children }: AvatarEditorProps) {
  const { t } = useLanguage();
  const shared = useAccountAvatar();
  const current = shared?.id === profile.id ? shared : profile;
  const [file, setFile] = useState<Attachment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [needsReload, setNeedsReload] = useState(false);
  const [retryUpload, setRetryUpload] = useState(false);
  const [revision, setRevision] = useState(0);
  const actionLock = useRef(false);
  const lifetime = useRef(new AbortController());
  const attempt = useRef<ReturnType<typeof createUploadAttempt> | undefined>(undefined);
  const mutation = useRef<{ fileId: string | null; expectedVersion: number; key: string } | undefined>(undefined);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const pending = file?.scanStatus === 'PENDING';
  useEffect(() => {
    if (!pending || !file) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      readAttachment(file.id, controller.signal).then((next) => { if (!controller.signal.aborted) { setFile(next); setRevision((value) => value + 1); } }).catch(() => { if (!controller.signal.aborted) setError('头像状态加载失败，请重试'); });
    }, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [file, pending, revision]);
  async function action(run: (signal: AbortSignal) => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(undefined);
    try { await run(lifetime.current.signal); }
    catch (cause) { if (!lifetime.current.signal.aborted) { setError(safeAccountError(cause)); if (cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') setNeedsReload(true); } }
    finally { actionLock.current = false; if (!lifetime.current.signal.aborted) setBusy(false); }
  }
  async function upload(selected?: File) {
    if (selected && (!['image/jpeg', 'image/png'].includes(selected.type) || selected.size < 1 || selected.size > 2 * 1024 * 1024)) { setError('请选择不超过 2 MiB 的 JPEG 或 PNG 图片'); return; }
    await action(async (signal) => {
      if (selected) attempt.current = createUploadAttempt({ resourceType: 'ACCOUNT_AVATAR', resourceId: profile.id }, selected);
      setRetryUpload(false);
      try {
        await attempt.current?.run((next) => { if (!signal.aborted) setFile(next); }, signal);
        attempt.current = undefined;
      } catch (cause) { if (!signal.aborted) setRetryUpload(true); throw cause; }
    });
  }
  async function save(fileId: string | null) {
    await action(async (signal) => {
      const epoch = accountAvatarEpoch();
      if (mutation.current?.fileId !== fileId || mutation.current.expectedVersion !== current.avatarVersion) mutation.current = { fileId, expectedVersion: current.avatarVersion, key: crypto.randomUUID() };
      const next = await updateAccountAvatar({ fileId, expectedVersion: mutation.current.expectedVersion }, mutation.current.key, signal);
      if (signal.aborted || epoch !== accountAvatarEpoch()) return;
      mutation.current = undefined;
      publishAccountAvatar(next, epoch); onChange(next); setFile(undefined);
    });
  }
  async function reloadAccount() {
    await action(async (signal) => {
      const epoch = accountAvatarEpoch();
      const next = await getAccountProfile(signal);
      if (signal.aborted || epoch !== accountAvatarEpoch() || next.id !== profile.id) return;
      mutation.current = undefined;
      publishAccountAvatar(next, epoch); onChange(next); setNeedsReload(false);
    });
  }
  const clean = file?.status === 'AVAILABLE' && file.scanStatus === 'CLEAN';
  const status = pending ? '等待安全扫描' : file?.scanStatus === 'ERROR' ? '扫描暂不可用，头像仍隔离' : file?.scanStatus === 'REJECTED' ? '扫描未通过，头像已隔离' : clean ? '扫描通过，可设为头像' : '等待上传完成';
  return <Space orientation="vertical" size="small" style={{ width: '100%' }}>
    <div className="qms-account-avatar-heading"><AccountAvatar profile={profile} size={64} />{children}</div>
    <Typography.Text type="secondary">{t('仅本人可见，JPEG/PNG，最大 2 MiB。')}</Typography.Text>
    {error ? <Alert type="error" showIcon title={t(error)} role="alert" /> : null}
    {needsReload ? <Button disabled={busy} onClick={() => void reloadAccount()}>{t('重新加载账号')}</Button> : null}
    <Space wrap>
      <label>{t('选择头像')} <input type="file" aria-label={t('选择头像')} accept="image/jpeg,image/png" disabled={busy || pending || retryUpload} onChange={(event) => { const next = event.target.files?.[0]; event.target.value = ''; if (next) void upload(next); }} /></label>
      {current.avatarFileId ? <Button disabled={busy || pending || needsReload} onClick={() => void save(null)}>{t('移除头像')}</Button> : null}
      {busy ? <Spin aria-label={t('正在处理头像')} /> : null}
      {retryUpload ? <><Button disabled={busy} onClick={() => void upload()}>{t('重试上传')}</Button><Button disabled={busy} onClick={() => { attempt.current = undefined; setRetryUpload(false); setFile(undefined); }}>{t('放弃重试')}</Button></> : null}
    </Space>
    {file ? <Space wrap><span role="status">{t(status)}</span>
      <Button disabled={busy} onClick={() => void action(async (signal) => { const next = await readAttachment(file.id, signal); if (!signal.aborted) { setFile(next); setRevision((value) => value + 1); } })}>{t('刷新头像状态')}</Button>
      {clean ? <Button type="primary" disabled={busy || needsReload} onClick={() => void save(file.id)}>{t('设为头像')}</Button> : null}
      {file.scanStatus === 'ERROR' ? <Button disabled={busy} onClick={() => void action(async (signal) => { const next = await retryScanAttachment(file); if (!signal.aborted) setFile(next); })}>{t('重试安全扫描')}</Button> : null}
    </Space> : null}
  </Space>;
}
