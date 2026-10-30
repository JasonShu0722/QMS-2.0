import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { authRedirect } from './return-to';

export function RequiredPasswordChangePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  const lifetime = useRef({ key: location.key, signal: new AbortController().signal });
  const pending = useRef(false);
  useLayoutEffect(() => {
    const scope = new AbortController();
    lifetime.current = { key: location.key, signal: scope.signal };
    pending.current = false;
    setReady(false); setBusy(false); setError(undefined); setTraceId(undefined);
    if (form.getFieldInstance('newPassword')) form.resetFields();
    return () => scope.abort();
  }, [location.key, form]);
  useEffect(() => {
    const signal = lifetime.current.signal;
    void apiRequest<components['schemas']['LoginResponseDto']>('/api/v1/auth/password-change').then(() => { if (!signal.aborted) setReady(true); }).catch((cause: unknown) => {
      if (!signal.aborted) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
    });
  }, [location.key]);
  async function submit(values: { newPassword: string }) {
    if (pending.current) return;
    const signal = lifetime.current.signal;
    if (signal.aborted || lifetime.current.key !== location.key) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const token = await csrfToken();
      if (signal.aborted) return;
      const result = await apiRequest<components['schemas']['LoginResponseDto']>('/api/v1/auth/password-change/complete', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify({ newPassword: values.newPassword }) });
      if (!signal.aborted) { form.resetFields(); const redirect = authRedirect(result, location.state); navigate(redirect.to, { replace: true, state: redirect.state }); }
    } catch (cause) { if (!signal.aborted) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); } }
    finally { if (!signal.aborted) { pending.current = false; setBusy(false); } }
  }
  async function exit() {
    if (pending.current) return;
    const signal = lifetime.current.signal;
    if (signal.aborted || lifetime.current.key !== location.key) return;
    pending.current = true; setBusy(true);
    try {
      const token = await csrfToken();
      if (signal.aborted) return;
      await apiRequest<void>('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': token } });
      if (!signal.aborted) { form.resetFields(); navigate('/login', { replace: true }); }
    }
    catch (cause) { if (!signal.aborted) setError(safeAccountError(cause)); }
    finally { if (!signal.aborted) { pending.current = false; setBusy(false); } }
  }
  return <main className="reset-page"><Card>
    <Typography.Title level={2}>{t('首次登录修改密码')}</Typography.Title>
    <Typography.Paragraph>{t('请设置个人密码，完成前不能访问业务功能。')}</Typography.Paragraph>
    {error && <Alert type="error" showIcon title={t(error)} description={traceId ? <code>{traceId}</code> : undefined} />}
    {!ready && !error && <Spin />}
    {ready && <Form form={form} layout="vertical" onFinish={submit} autoComplete="off" disabled={busy}>
      <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true }, { min: 12, max: 256, message: t('密码须为 12–256 位') }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item name="confirmation" label={t('确认新密码')} dependencies={['newPassword']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error(t('两次密码不一致'))) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Space wrap><Button type="primary" htmlType="submit" loading={busy}>{t('保存新密码')}</Button></Space>
    </Form>}
    <Button type="link" disabled={busy} onClick={() => void exit()}>{t('退出并返回登录')}</Button>
  </Card></main>;
}
