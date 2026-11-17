import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Space } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, csrfToken, safeAccountError } from '../../api/client';
import { scopePath, type AdminUser } from './admin';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type TemporaryPassword = components['schemas']['TemporaryPasswordDto'];

type Props = {
  user: Pick<AdminUser, 'id' | 'username'>; organizationId: string;
  domain?: { read: () => Promise<TemporaryPassword>; reset: () => Promise<TemporaryPassword> };
  canRead?: boolean; canReset?: boolean; initialValue?: TemporaryPassword; busyChanged?: (busy: boolean) => void;
};

export function UserTemporaryPassword(props: Props) {
  return <PasswordContent key={`${props.organizationId}:${props.user.id}`} {...props} />;
}

function PasswordContent({ user, organizationId, domain, canRead = true, canReset = true, initialValue, busyChanged }: Props) {
  const { t } = useLanguage();
  const [value, setValue] = useState<TemporaryPassword | undefined>(initialValue);
  const [supplied, setSupplied] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  useNavigationBusy(busy);
  useUnsavedChanges(supplied.length > 0 || unknown);
  const alive = useRef(true);
  const pending = useRef(false);
  const mutate = useRef(createAdminMutation());
  const resetAttempt = useRef<{ path: string; body: components['schemas']['ResetTemporaryPasswordDto']; domainReset?: () => Promise<TemporaryPassword> } | undefined>(undefined);
  const access = useRef({ canRead, canReset, epoch: 0 });
  if (access.current.canRead !== canRead || access.current.canReset !== canReset) access.current = { canRead, canReset, epoch: access.current.epoch + 1 };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!canRead || access.current.epoch > 0) setValue(undefined); setSupplied(''); resetAttempt.current = undefined; mutate.current = createAdminMutation(); setUnknown(false); }, [canRead, canReset]);
  function permitted(epoch: number, permission: 'canRead' | 'canReset') { return alive.current && access.current.epoch === epoch && access.current[permission]; }
  async function read(epoch: number) {
    if (!permitted(epoch, 'canRead')) return;
    const result = domain ? await domain.read() : await apiRequest<TemporaryPassword>(scopePath(`users/${user.id}/temporary-password/read`, organizationId), { method: 'POST', headers: { 'x-csrf-token': await csrfToken() }, body: '{}' });
    if (!permitted(epoch, 'canRead')) return;
    setValue(result);
    return result;
  }
  async function perform(action: (epoch: number) => Promise<void>, permission: 'canRead' | 'canReset' = 'canRead') {
    const epoch = access.current.epoch;
    if (pending.current || !permitted(epoch, permission)) return;
    pending.current = true; setBusy(true); busyChanged?.(true); setError(undefined);
    try { await action(epoch); if (permitted(epoch, permission) && permission === 'canReset') setUnknown(false); }
    catch (cause) { if (permitted(epoch, permission)) { setValue(undefined); setError(safeAccountError(cause)); if (permission === 'canReset') { if (unknown || !(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408 || cause.status === 425) setUnknown(true); else resetAttempt.current = undefined; } } }
    finally { pending.current = false; if (alive.current) { setBusy(false); busyChanged?.(false); } }
  }
  async function resetPassword(epoch: number) {
    const command = resetAttempt.current ??= { path: scopePath(`users/${user.id}/temporary-password/reset`, organizationId), body: supplied ? { temporaryPassword: supplied } : {}, domainReset: domain?.reset };
    const result = command.domainReset ? await command.domainReset() : await mutate.current<TemporaryPassword>(command.path, 'POST', command.body);
    if (permitted(epoch, 'canReset')) { resetAttempt.current = undefined; setSupplied(''); if (access.current.canRead) setValue(result); }
  }
  async function download(epoch: number) {
    const current = await read(epoch);
    if (!current || !permitted(epoch, 'canRead') || current.status !== 'AVAILABLE' || !current.temporaryPassword) return;
    const ExcelJS = (await import('exceljs')).default;
    if (!permitted(epoch, 'canRead')) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(t('临时密码'));
    sheet.addRow(['用户名', '临时密码', '有效期至'].map(t));
    sheet.addRow([user.username, current.temporaryPassword, current.expiresAt ?? '']);
    sheet.columns.forEach((column) => { column.numFmt = '@'; column.width = 30; });
    const bytes = await workbook.xlsx.writeBuffer();
    if (!permitted(epoch, 'canRead')) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = `${t('有效临时密码')}.xlsx`; link.click(); URL.revokeObjectURL(url);
  }
  return <Space orientation="vertical" className="admin-form-stack">
    {error && <Alert type="error" showIcon title={t(error)} />}
    {unknown && <Alert type="warning" showIcon title={t('原请求结果尚未确认，请重试原请求或明确放弃。')} />}
    {canRead && value && <Alert type={value.status === 'AVAILABLE' ? 'success' : 'info'} title={value.status === 'AVAILABLE' ? <code>{value.temporaryPassword}</code> : t(value.status === 'EXPIRED' ? '已过期' : '不可用')} />}
    {canRead ? <><Space wrap><Button disabled={busy} onClick={() => void perform(async (epoch) => { await read(epoch); })}>{t('查询临时密码')}</Button>
      <Button disabled={busy || value?.status !== 'AVAILABLE'} onClick={() => void perform(async (epoch) => { const current = await read(epoch); if (current && permitted(epoch, 'canRead') && current.status === 'AVAILABLE' && current.temporaryPassword) await navigator.clipboard.writeText(current.temporaryPassword); })}>{t('复制临时密码')}</Button></Space>
    <Button disabled={busy || value?.status !== 'AVAILABLE'} onClick={() => void perform(download)}>{t('下载有效临时密码')}</Button></> : null}
    {canReset ? <>{!domain ? <Input.Password aria-label={t('管理员设定临时密码')} placeholder={t('留空则自动生成')} autoComplete="new-password" disabled={busy || unknown} value={supplied} onChange={(event) => { if (!unknown && !pending.current) setSupplied(event.target.value); }} /> : null}
    <Popconfirm title={t('确认重置并撤销会话？')} description={t('旧密码和目标账号的现有会话将立即失效，首次登录需改密。')} okText={t('确认重置')} cancelText={t('取消')} disabled={busy || unknown} onConfirm={() => perform(resetPassword, 'canReset')}><Button danger disabled={busy || unknown || Boolean(supplied && (supplied.length < 12 || supplied.length > 256))}>{t('直接重置临时密码')}</Button></Popconfirm>
    {unknown && <Space wrap><Button disabled={busy} loading={busy} onClick={() => void perform(resetPassword, 'canReset')}>{t('重试确认结果')}</Button>{!domain && <Popconfirm title={t('放弃未确认的请求？')} description={t('原请求结果尚未确认，放弃后无法继续重试原请求。')} okText={t('放弃修改')} cancelText={t('取消')} disabled={busy} onConfirm={() => { if (pending.current) return; resetAttempt.current = undefined; mutate.current = createAdminMutation(); setUnknown(false); setSupplied(''); setValue(undefined); setError(undefined); }}><Button disabled={busy}>{t('放弃修改')}</Button></Popconfirm>}</Space>}
    </> : null}
  </Space>;
}
