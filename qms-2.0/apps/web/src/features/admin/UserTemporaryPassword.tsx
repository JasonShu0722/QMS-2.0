import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Space, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { apiRequest, createAdminMutation, csrfToken, safeAccountError } from '../../api/client';
import { scopePath, type AdminUser } from './admin';
import { useLanguage } from '../../i18n/Language';

type TemporaryPassword = components['schemas']['TemporaryPasswordDto'];

export function UserTemporaryPassword({ user, organizationId }: { user: AdminUser; organizationId: string }) {
  const { t } = useLanguage();
  const [value, setValue] = useState<TemporaryPassword>();
  const [supplied, setSupplied] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const mutate = useRef(createAdminMutation());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function read() {
    const result = await apiRequest<TemporaryPassword>(scopePath(`users/${user.id}/temporary-password/read`, organizationId), { method: 'POST', headers: { 'x-csrf-token': await csrfToken() }, body: '{}' });
    if (alive.current) setValue(result);
    return result;
  }
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined);
    try { await action(); }
    catch (cause) { if (alive.current) { setValue(undefined); setError(safeAccountError(cause)); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function download() {
    const current = await read();
    if (!alive.current || current.status !== 'AVAILABLE' || !current.temporaryPassword) return;
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('临时密码');
    sheet.addRow(['用户名', '临时密码', '有效期至']);
    sheet.addRow([user.username, current.temporaryPassword, current.expiresAt ?? '']);
    sheet.columns.forEach((column) => { column.numFmt = '@'; column.width = 30; });
    const bytes = await workbook.xlsx.writeBuffer();
    if (!alive.current) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = '有效临时密码.xlsx'; link.click(); URL.revokeObjectURL(url);
  }
  return <Space orientation="vertical" className="admin-form-stack">
    <Typography.Paragraph>{t('仅有效临时密码可查询；长期密码不可读取。直接重置会立即撤销目标账号会话并要求首次改密。')}</Typography.Paragraph>
    {error && <Alert type="error" showIcon title={t(error)} />}
    {value && <Alert type={value.status === 'AVAILABLE' ? 'success' : 'info'} title={value.status === 'AVAILABLE' ? <code>{value.temporaryPassword}</code> : t(value.status === 'EXPIRED' ? '已过期' : '不可用')} />}
    <Space wrap><Button disabled={busy} onClick={() => void perform(async () => { await read(); })}>{t('查询临时密码')}</Button>
      <Button disabled={busy || value?.status !== 'AVAILABLE'} onClick={() => void perform(async () => { const current = await read(); if (alive.current && current.status === 'AVAILABLE' && current.temporaryPassword) await navigator.clipboard.writeText(current.temporaryPassword); })}>{t('复制临时密码')}</Button></Space>
    <Button disabled={busy || value?.status !== 'AVAILABLE'} onClick={() => void perform(download)}>{t('下载有效临时密码')}</Button>
    <Input.Password aria-label={t('管理员设定临时密码')} placeholder={t('留空则自动生成')} autoComplete="new-password" value={supplied} onChange={(event) => setSupplied(event.target.value)} />
    <Popconfirm title={t('确认重置并撤销会话？')} description={t('旧密码和目标账号的现有会话将立即失效。')} okText={t('确认重置')} cancelText={t('取消')} onConfirm={() => perform(async () => {
      const result = await mutate.current<TemporaryPassword>(scopePath(`users/${user.id}/temporary-password/reset`, organizationId), 'POST', supplied ? { temporaryPassword: supplied } : {});
      if (alive.current) { setSupplied(''); setValue(result); }
    })}><Button danger disabled={busy || Boolean(supplied && (supplied.length < 12 || supplied.length > 256))}>{t('直接重置临时密码')}</Button></Popconfirm>
  </Space>;
}
