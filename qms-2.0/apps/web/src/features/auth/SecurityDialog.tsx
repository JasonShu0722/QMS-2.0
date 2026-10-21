import { useState } from 'react';
import { Button, Modal } from 'antd';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../i18n/Language';
import { SecurityContent, type SecurityCloseState } from './SecurityPage';

export function SecurityDialog({ open, onClose, afterClose }: { open: boolean; onClose: () => void; afterClose?: () => void }) {
  const { t } = useLanguage();
  const [closeState, setCloseState] = useState<SecurityCloseState>({ busy: false, hasSecrets: false });
  const [confirmClose, setConfirmClose] = useState(false);
  function close() {
    if (closeState.busy) return;
    if (closeState.hasSecrets) setConfirmClose(true);
    else onClose();
  }
  return <>
    <Modal open={open} className="qms-security-dialog" width={600} centered title={<span className="qms-security-title"><ShieldCheck size={20} aria-hidden="true" />{t('账号安全')}</span>} footer={<div className="qms-dialog-actions" role="group" aria-label={t('账号安全')}><Button aria-label={t('关闭账号安全')} onClick={close} disabled={closeState.busy}>{t('关闭')}</Button></div>} onCancel={close} keyboard={!closeState.busy} closable={!closeState.busy} mask={{ closable: !closeState.busy }} afterClose={afterClose} destroyOnHidden>
      <p className="qms-security-subtitle">{t('管理登录验证与账号恢复方式')}</p>
      {open ? <SecurityContent embedded onCloseStateChange={setCloseState} /> : null}
    </Modal>
    <Modal open={open && confirmClose} title={t('关闭账号安全？')} okText={t('确认关闭')} cancelText={t('继续查看')} onCancel={() => setConfirmClose(false)} onOk={() => { setConfirmClose(false); onClose(); }} destroyOnHidden>
      <p>{t('未完成的绑定信息或恢复码将被清除，请确认已安全保存。')}</p>
    </Modal>
  </>;
}
