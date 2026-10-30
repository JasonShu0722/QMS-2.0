import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Form, Input, Modal } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, registerReauthentication } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import { subscribeSessionSignals } from './session-invalidation';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

export function ReauthenticationProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [form] = Form.useForm();
  const submitting = useRef(false);
  const pending = useRef<{ promise: Promise<void>; resolve: () => void; reject: (cause: Error) => void; controller: AbortController } | undefined>(undefined);
  const clearPending = useCallback((cause: Error) => {
    const previous = pending.current; pending.current = undefined;
    previous?.controller.abort(); previous?.reject(cause);
    submitting.current = false; form.resetFields(); setError(undefined); setSaving(false); setOpen(false);
  }, [form]);
  useEffect(() => {
    const unregister = registerReauthentication(() => {
      if (pending.current) return pending.current.promise;
      let resolve!: () => void;
      let reject!: (cause: Error) => void;
      const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
      pending.current = { promise, resolve, reject, controller: new AbortController() };
      submitting.current = false; setSaving(false); setError(undefined); form.resetFields(); setOpen(true);
      return promise;
    });
    const stopSignals = subscribeSessionSignals(signal => { if (signal === 'invalidate') { useWorkTabsStore.getState().reset(); clearPending(new DOMException('Session changed', 'AbortError')); } });
    return () => { stopSignals(); unregister(); const previous = pending.current; pending.current = undefined; previous?.controller.abort(); previous?.reject(new DOMException('Authentication interrupted', 'AbortError')); form.resetFields(); };
  }, [form, clearPending]);
  function cancel() {
    clearPending(new ApiError({ code: 'AUTH_REAUTHENTICATION_REQUIRED', message: t('此操作需要重新验证身份') }));
  }
  async function submit(values: components['schemas']['ReauthenticateDto']) {
    const attempt = pending.current;
    if (!attempt || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError(undefined);
    try {
      const token = await csrfToken(attempt.controller.signal);
      if (pending.current !== attempt || attempt.controller.signal.aborted) return;
      await apiRequest('/api/v1/me/reauthenticate', { method: 'POST', signal: attempt.controller.signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(values) });
      if (pending.current !== attempt || attempt.controller.signal.aborted) return;
      pending.current = undefined; submitting.current = false; setSaving(false); form.resetFields(); setOpen(false); attempt.resolve();
    } catch (cause) { if (pending.current === attempt && !attempt.controller.signal.aborted) setError(cause); }
    finally { if (pending.current === attempt && !attempt.controller.signal.aborted) { submitting.current = false; setSaving(false); } }
  }
  return <>{children}<Modal open={open} title={t('重新验证身份')} onOk={() => form.submit()} onCancel={cancel} okText={t('验证')} cancelText={t('取消')} confirmLoading={saving} closable={!saving} maskClosable={false} cancelButtonProps={{ disabled: saving }} destroyOnHidden>
    <GovernanceFeedback error={error} /><Form form={form} layout="vertical" onFinish={submit} disabled={saving} preserve={false} clearOnDestroy>
      <Form.Item name="password" label={t('当前密码')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" autoFocus /></Form.Item>
      <Form.Item name="code" label={t('验证码或恢复码')}><Input autoComplete="one-time-code" maxLength={43} /></Form.Item>
    </Form>
  </Modal></>;
}
