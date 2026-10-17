import { useEffect, useState } from 'react';
import { Avatar, Button, Space } from 'antd';
import type { AccountProfile } from '@qms/contracts';
import { attachmentDownload } from '../attachments/attachments';
import { useLanguage } from '../../i18n/Language';
import { accountAvatarEpoch, useAccountAvatar } from './account-avatar-state';

export function AccountAvatar({ profile, size = 28 }: { profile?: AccountProfile; size?: number }) {
  const { t } = useLanguage();
  const shared = useAccountAvatar();
  const fileId = shared?.id === profile?.id ? shared?.avatarFileId : undefined;
  const epoch = accountAvatarEpoch();
  const key = `${epoch}:${profile?.id}:${fileId}`;
  const [image, setImage] = useState<{ key: string; url: string }>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setImage(undefined); setFailed(false);
    if (fileId) void (async () => {
      try {
        const url = await attachmentDownload(fileId);
        controller.signal.throwIfAborted();
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('AVATAR_DOWNLOAD_FAILED');
        const bytes = await response.blob();
        controller.signal.throwIfAborted();
        if (epoch !== accountAvatarEpoch()) return;
        objectUrl = URL.createObjectURL(bytes);
        setImage({ key, url: objectUrl });
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [epoch, fileId, key, retry]);
  return <Space size={4}>
    <Avatar size={size} src={image?.key === key ? image.url : undefined} alt={t('本人头像')} onError={() => { setFailed(true); return false; }}>{(profile?.username?.[0] ?? '?').toUpperCase()}</Avatar>
    {failed && size > 28 ? <Button size="small" onClick={() => setRetry((value) => value + 1)}>{t('重试加载头像')}</Button> : null}
  </Space>;
}
