import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Form, Input, Modal } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, registerReauthentication } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

export function ReauthenticationProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [form] = Form.useForm();
  const submitting = useRef(false);
  const pending = useRef<{ promise: Promise<void>; resolve: () => void; reject: (cause: Error) => void } | undefined>(undefined);
  useEffect(() => {
    const unregister = registerReauthentication(() => {
      if (pending.current) return pending.current.promise;
      let resolve!: () => void;
      let reject!: (cause: Error) => void;
      const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
      pending.current = { promise, resolve, reject };
      setError(undefined); form.resetFields(); setOpen(true);
      return promise;
    });
    return () => { unregister(); pending.current?.reject(new Error('Authentication interrupted')); pending.current = undefined; };
  }, [form]);
  function cancel() {
    pending.current?.reject(new ApiError({ code: 'AUTH_REAUTHENTICATION_REQUIRED', message: t('此操作需要重新验证身份') }));
    pending.current = undefined; form.resetFields(); setOpen(false);
  }
  async function submit(values: components['schemas']['ReauthenticateDto']) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true); setError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest('/api/v1/me/reauthenticate', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(values) });
      pending.current?.resolve(); pending.current = undefined; form.resetFields(); setOpen(false);
    } catch (cause) { setError(cause); } finally { submitting.current = false; setSaving(false); }
  }
  return <>{children}<Modal open={open} title={t('重新验证身份')} onOk={() => form.submit()} onCancel={cancel} okText={t('验证')} cancelText={t('取消')} confirmLoading={saving} closable={!saving} maskClosable={false} cancelButtonProps={{ disabled: saving }} destroyOnHidden>
    <GovernanceFeedback error={error} /><Form form={form} layout="vertical" onFinish={submit} disabled={saving}>
      <Form.Item name="password" label={t('当前密码')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" autoFocus /></Form.Item>
      <Form.Item name="code" label={t('验证码或恢复码')}><Input autoComplete="one-time-code" maxLength={43} /></Form.Item>
    </Form>
  </Modal></>;
}
