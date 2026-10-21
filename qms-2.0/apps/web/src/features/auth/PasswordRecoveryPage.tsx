import { useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Tabs } from 'antd';
import { Link } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

export function PasswordRecoveryPage() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  const [form] = Form.useForm();
  const pending = useRef(false);
  async function submit(path: string, body: components['schemas']['PasswordRecoveryDto'] | components['schemas']['CompletePasswordRecoveryDto']) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const token = await csrfToken();
      await apiRequest(`/api/v1/auth/${path}`, { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
      setMessage(path.endsWith('/complete') ? '密码已重置，请重新登录' : '如果账号绑定了已确认邮箱，将收到一次性找回凭证。');
      if (path.endsWith('/complete')) form.resetFields();
    } catch (cause) { setError(cause); } finally { pending.current = false; setBusy(false); }
  }
  return <main className="security-page"><Card title={t('找回密码')}><GovernanceFeedback error={error} />{message ? <Alert type="success" role="status" title={t(message)} /> : null}
    <Tabs items={[
      { key: 'request', label: t('申请找回'), children: <Form layout="vertical" disabled={busy} onFinish={(values: components['schemas']['PasswordRecoveryDto']) => void submit('password-recovery', values)}>
        <Form.Item name="identifier" label={t('账号或邮箱')} rules={[{ required: true, whitespace: true }]}><Input autoComplete="username" maxLength={254} /></Form.Item>
        <Form.Item name="organizationCode" label={t('组织代码（选填）')}><Input maxLength={64} /></Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>{t('发送找回邮件')}</Button>
      </Form> },
      { key: 'complete', label: t('使用邮件凭证'), children: <Form form={form} layout="vertical" disabled={busy} onFinish={(values: components['schemas']['CompletePasswordRecoveryDto']) => void submit('password-recovery/complete', values)}>
        <Form.Item name="token" label={t('邮件凭证')} rules={[{ required: true }, { len: 43 }]}><Input.Password autoComplete="off" maxLength={43} /></Form.Item>
        <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true }, { min: 12, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>{t('重置密码')}</Button>
      </Form> },
    ]} /><Link to="/login">{t('返回登录')}</Link>
  </Card></main>;
}
