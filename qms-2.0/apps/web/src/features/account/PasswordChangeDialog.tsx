import { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal } from 'antd';
import type { components } from '@qms/contracts';
import { changeAccountPassword } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { accountAvatarEpoch } from './account-avatar-state';
import './account.css';

export function PasswordChangeDialog({ onClose, onSuccess, afterClose }: { onClose: () => void; onSuccess: () => void; afterClose: () => void }) {
  const { t } = useLanguage();
  const [form] = Form.useForm<components['schemas']['ChangePasswordDto']>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>();
  const [open, setOpen] = useState(true);
  const pending = useRef(false);
  const alive = useRef(false);
  const epoch = useRef(accountAvatarEpoch());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function close() {
    form.resetFields(); setDirty(false); setError(undefined); setConfirm(false); setOpen(false);
  }
  function requestClose() {
    if (pending.current) return;
    if (dirty) setConfirm(true); else close();
  }
  async function submit(values: components['schemas']['ChangePasswordDto']) {
    if (pending.current || !open) return;
    pending.current = true; setBusy(true); setError(undefined);
    const current = () => alive.current && epoch.current === accountAvatarEpoch();
    try {
      await changeAccountPassword(values);
      if (current()) { close(); onSuccess(); }
    } catch (cause) { if (current()) setError(cause); }
    finally { pending.current = false; if (current()) setBusy(false); }
  }
  return <>
    <Modal open={open} title={t('修改密码')} width={440} centered className="qms-password-dialog" destroyOnHidden keyboard={!busy} closable={!busy} mask={{ closable: !busy }} onCancel={requestClose} afterClose={() => { onClose(); afterClose(); }} footer={<div className="qms-dialog-actions" role="group" aria-label={t('修改密码')}><Button disabled={busy} onClick={requestClose}>{t('取消')}</Button><Button type="primary" loading={busy} onClick={() => form.submit()}>{t('修改密码')}</Button></div>}>
      <GovernanceFeedback error={error} />
      <Form form={form} layout="vertical" disabled={busy} preserve={false} clearOnDestroy onFinish={submit} onValuesChange={(_, values) => setDirty(!!values.currentPassword || !!values.newPassword)}>
        <Form.Item name="currentPassword" label={t('当前密码')} rules={[{ required: true, message: t('请输入当前密码') }]}><Input.Password autoFocus autoComplete="current-password" /></Form.Item>
        <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true, message: t('请输入新密码') }, { min: 12, message: t('新密码至少 12 位') }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button className="qms-password-submit" htmlType="submit" tabIndex={-1} aria-hidden="true" disabled={busy} />
      </Form>
    </Modal>
    <Modal open={open && confirm} title={t('放弃密码修改？')} okText={t('放弃修改')} cancelText={t('继续编辑')} okButtonProps={{ danger: true }} onCancel={() => setConfirm(false)} onOk={close} destroyOnHidden><p>{t('关闭后将清除已输入的密码。')}</p></Modal>
  </>;
}
