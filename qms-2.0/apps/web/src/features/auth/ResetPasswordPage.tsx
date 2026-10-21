import { useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { ApiError, completePasswordReset, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';

export function ResetPasswordPage() {
  const { t } = useLanguage();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);
  async function submit(values: { credential: string; newPassword: string }) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined); setTraceId(undefined); setSuccess(false);
    try {
      const [resetId, temporaryCode, extra] = values.credential.trim().split('.');
      if (!resetId || !temporaryCode || extra) { setError('请输入完整重置凭证'); return; }
      await completePasswordReset({ resetId, temporaryCode, newPassword: values.newPassword });
      form.resetFields(); setSuccess(true);
    } catch (cause) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className="reset-page"><Card>
    <Typography.Title level={2}>{t('重置密码')}</Typography.Title>
    {error && <Alert type="error" title={t(error)} description={traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined} showIcon />}
    {success && <Alert type="success" title={t('密码已重置，请重新登录')} showIcon />}
    <Form form={form} layout="vertical" onFinish={submit} autoComplete="off" disabled={busy}>
      <Form.Item name="credential" label={t('重置凭证')} rules={[{ required: true, message: t('请输入管理员提供的重置凭证') }]}><Input.Password autoComplete="off" /></Form.Item>
      <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true }, { min: 12, max: 256, message: t('密码须为 12–256 位') }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>{t('重置密码')}</Button>
    </Form>
    <Link to="/login">{t('返回登录')}</Link>
  </Card></main>;
}
