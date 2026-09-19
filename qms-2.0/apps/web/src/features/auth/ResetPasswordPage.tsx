import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { completePasswordReset, safeAccountError } from '../../api/client';

export function ResetPasswordPage() {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  async function submit(values: { credential: string; newPassword: string }) {
    setBusy(true); setError(undefined); setSuccess(false);
    try {
      const [resetId, temporaryCode, extra] = values.credential.trim().split('.');
      if (!resetId || !temporaryCode || extra) { setError('请输入完整重置凭证'); return; }
      await completePasswordReset({ resetId, temporaryCode, newPassword: values.newPassword });
      form.resetFields(); setSuccess(true);
    } catch (cause) { setError(safeAccountError(cause)); }
    finally { setBusy(false); }
  }
  return <main className="reset-page"><Card>
    <Typography.Title level={2}>重置密码</Typography.Title>
    {error && <Alert type="error" title={error} showIcon />}
    {success && <Alert type="success" title="密码已重置，请重新登录" showIcon />}
    <Form form={form} layout="vertical" onFinish={submit} autoComplete="off">
      <Form.Item name="credential" label="重置凭证" rules={[{ required: true, message: '请输入管理员提供的重置凭证' }]}><Input.Password autoComplete="off" /></Form.Item>
      <Form.Item name="newPassword" label="新密码" rules={[{ required: true }, { min: 12, max: 256, message: '密码须为 12–256 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>重置密码</Button>
    </Form>
    <Link to="/login">返回登录</Link>
  </Card></main>;
}
