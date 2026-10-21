import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';

export function RequiredPasswordChangePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    void apiRequest<components['schemas']['LoginResponseDto']>('/api/v1/auth/password-change').then(() => { if (alive.current) setReady(true); }).catch((cause: unknown) => {
      if (alive.current) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
    });
    return () => { alive.current = false; };
  }, []);
  async function submit(values: { newPassword: string }) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const token = await csrfToken();
      const result = await apiRequest<components['schemas']['LoginResponseDto']>('/api/v1/auth/password-change/complete', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify({ newPassword: values.newPassword }) });
      if (alive.current) { form.resetFields(); navigate(result.landingPath, { replace: true }); }
    } catch (cause) { if (alive.current) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function exit() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const token = await csrfToken();
      await apiRequest<void>('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': token } });
      if (alive.current) { form.resetFields(); navigate('/login', { replace: true }); }
    }
    catch (cause) { if (alive.current) setError(safeAccountError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
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
