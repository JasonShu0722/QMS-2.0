import { Alert, Avatar, Button, Dropdown, Modal, Space } from 'antd';
import type { AccountProfile } from '@qms/contracts';
import type { MenuProps } from 'antd';
import { ChevronDown, LogOut, RefreshCw, Settings, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAccountProfile, logout, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SecurityDialog } from '../auth/SecurityDialog';

type Props = { supplier?: boolean };

export function AccountMenu({ supplier = false }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<Pick<AccountProfile, 'username'>>();
  const [profileError, setProfileError] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(false);
  const logoutPending = useRef(false);

  async function loadProfile() {
    setProfileError(false);
    try {
      const next = await getAccountProfile();
      if (alive.current) setProfile({ username: next.username });
    } catch {
      if (alive.current) setProfileError(true);
    }
  }
  useEffect(() => { alive.current = true; void loadProfile(); return () => { alive.current = false; }; }, []);

  const prefix = supplier ? '/supplier' : '/app';
  function restoreFocus() { window.setTimeout(() => triggerRef.current?.focus(), 0); }
  function closeMenu(restore = true) { setOpen(false); if (restore) restoreFocus(); }
  function beginLogout() {
    closeMenu(false);
    requestLeave(() => { setError(undefined); setConfirmOpen(true); });
  }
  async function confirmLogout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setBusy(true); setError(undefined);
    try {
      await logout();
      useWorkTabsStore.getState().reset();
      setConfirmOpen(false);
      navigate('/login', { replace: true });
    } catch (cause) {
      setError(cause);
    } finally {
      logoutPending.current = false;
      setBusy(false);
    }
  }
  const username = profile?.username;
  const label = username ? `${t('个人菜单')} · ${username}` : t('个人菜单');
  const items: MenuProps['items'] = [
    { key: 'settings', icon: <Settings size={16} />, label: t('个人设置') },
    { key: 'password', icon: <KeyRound size={16} />, label: t('修改密码') },
    { key: 'security', icon: <ShieldCheck size={16} />, label: t('账号安全') },
    { type: 'divider' },
    ...(profileError ? [{ key: 'retry', icon: <RefreshCw size={16} />, label: t('重新加载账号') }] : []),
    { key: 'logout', danger: true, icon: <LogOut size={16} />, label: t('退出登录') },
  ];
  function onMenuClick({ key }: { key: string }) {
    if (key === 'retry') { void loadProfile(); return; }
    if (key === 'logout') { beginLogout(); return; }
    if (key === 'security') { closeMenu(false); setSecurityOpen(true); return; }
    closeMenu();
    requestLeave(() => navigate(key === 'password' ? `${prefix}/account#password` : `${prefix}/account`));
  }

  return <>
    <Dropdown open={open} onOpenChange={(next) => { setOpen(next); if (!next) restoreFocus(); }} trigger={['click']} placement="bottomRight" autoFocus menu={{ items, onClick: onMenuClick }}>
      <Button ref={triggerRef} className="qms-account-menu-trigger" type="text" aria-label={label} aria-haspopup="menu" aria-expanded={open}>
        <Space size={6}><Avatar size={28}>{(username?.[0] ?? '?').toUpperCase()}</Avatar><span className="qms-account-menu-name">{username ?? t('个人账号')}</span><ChevronDown className="qms-account-menu-chevron" size={14} aria-hidden="true" /></Space>
      </Button>
    </Dropdown>
    <SecurityDialog open={securityOpen} onClose={() => setSecurityOpen(false)} afterClose={restoreFocus} />
    <Modal open={confirmOpen} title={t('确认退出登录？')} okText={t('退出登录')} cancelText={t('取消')} okButtonProps={{ danger: true, loading: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} mask={{ closable: !busy }} onCancel={() => { if (!busy) { setConfirmOpen(false); restoreFocus(); } }} onOk={() => void confirmLogout()}>
      {error ? <Alert type="error" showIcon role="alert" title={t(safeAccountError(error))} /> : <p>{t('退出后将清除当前会话的工作标签。')}</p>}
    </Modal>
  </>;
}
