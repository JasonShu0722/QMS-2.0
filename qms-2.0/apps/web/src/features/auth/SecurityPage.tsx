import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, QRCode, Space, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

type SecurityStatus = components['schemas']['SecurityStatusDto'];
type Enrollment = components['schemas']['MfaEnrollmentDto'];
async function securityPost<Result>(path: string, body?: components['schemas']['MfaCodeDto'] | components['schemas']['CompleteEmailVerificationDto']) {
  const token = await csrfToken();
  return apiRequest<Result>(`/api/v1/${path}`, { method: 'POST', headers: { 'x-csrf-token': token }, body: body ? JSON.stringify(body) : undefined });
}

export function SecurityPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SecurityStatus>();
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [codes, setCodes] = useState<string[]>();
  const [landingPath, setLandingPath] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [form] = Form.useForm();
  const [emailForm] = Form.useForm();
  useEffect(() => {
    let active = true;
    void apiRequest<SecurityStatus>('/api/v1/me/security').then((result) => { if (active) { setStatus(result); setError(undefined); } }).catch((cause) => { if (active) setError(cause); });
    return () => { active = false; };
  }, [revision]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function verify(body: components['schemas']['MfaCodeDto']) {
    await perform(async () => {
      if (enrollment) {
        const result = await securityPost<components['schemas']['MfaEnrollmentCompleteDto']>('me/mfa/enrollment/confirm', body);
        setCodes(result.recoveryCodes); setLandingPath(result.landingPath); setEnrollment(undefined); setRevision((value) => value + 1);
      } else {
        const result = await securityPost<components['schemas']['LoginResponseDto']>('auth/mfa/verify', body);
        navigate(result.landingPath, { replace: true });
      }
      form.resetFields();
    });
  }
  return <main className="security-page"><Card title={t('账号安全')} loading={!status && !error}>
    <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} />
    {codes ? <section aria-label={t('恢复码')}><Alert type="warning" showIcon title={t('请离线保存恢复码，每个仅可使用一次。关闭后无法再次查看。')} /><pre className="recovery-codes">{codes.join('\n')}</pre><Button onClick={() => { setCodes(undefined); if (landingPath) navigate(landingPath, { replace: true }); }}>{t('已保存，继续')}</Button></section> : status ? <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Paragraph>{t(status.mfaEnabled ? 'MFA 已启用' : 'MFA 未启用')}{status.mfaRequired ? ` · ${t('账号策略要求启用 MFA')}` : ''}</Typography.Paragraph>
      {enrollment ? <section><Typography.Paragraph>{t('使用验证器扫描二维码或手动输入密钥，然后输入验证码。')}</Typography.Paragraph><QRCode value={enrollment.otpauthUri} /><Typography.Paragraph copyable>{enrollment.secret}</Typography.Paragraph><Typography.Text>{t('有效期至')}: {new Date(enrollment.expiresAt).toLocaleString()}</Typography.Text></section> : null}
      {enrollment || status.securityState === 'MFA_REQUIRED' ? <Form form={form} layout="vertical" onFinish={verify} disabled={busy}><Form.Item name="code" label={t('验证码或恢复码')} rules={[{ required: true }]}><Input autoFocus autoComplete="one-time-code" maxLength={43} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>{t('验证')}</Button></Form> : null}
      {!status.mfaEnabled && !enrollment ? <Button type="primary" loading={busy} onClick={() => void perform(async () => setEnrollment(await securityPost<Enrollment>('me/mfa/enrollment')))}>{t('启用 MFA')}</Button> : null}
      {status.mfaEnabled && status.securityState === 'AUTHENTICATED' ? <><Typography.Text>{t('剩余恢复码')}: {status.recoveryCodesRemaining}</Typography.Text><Button loading={busy} onClick={() => void perform(async () => { const result = await securityPost<components['schemas']['RecoveryCodesDto']>('me/mfa/recovery-codes'); setCodes(result.recoveryCodes); setRevision((value) => value + 1); })}>{t('重新生成恢复码')}</Button>{!status.mfaRequired ? <Button danger loading={busy} onClick={() => void perform(async () => { await securityPost('me/mfa/disable'); navigate('/login', { replace: true }); })}>{t('停用 MFA 并退出')}</Button> : null}</> : null}
      {status.securityState === 'AUTHENTICATED' ? <section aria-label={t('邮箱确认')}><Typography.Title level={3}>{t('邮箱确认')}</Typography.Title><Typography.Paragraph>{t(status.emailVerifiedAt ? '邮箱已确认' : '确认邮箱后可使用自助密码找回。')}</Typography.Paragraph>{emailMessage ? <Alert type="success" role="status" title={t(emailMessage)} /> : null}{!status.emailVerifiedAt ? <><Button loading={busy} onClick={() => void perform(async () => { await securityPost('me/email-verification'); setEmailMessage('确认邮件已申请，请查看邮箱。'); })}>{t('发送确认邮件')}</Button><Form form={emailForm} layout="vertical" disabled={busy} onFinish={(values: components['schemas']['CompleteEmailVerificationDto']) => void perform(async () => { await securityPost('auth/email-verification/complete', values); emailForm.resetFields(); setEmailMessage('邮箱已确认'); setRevision((value) => value + 1); })}><Form.Item name="token" label={t('邮件凭证')} rules={[{ required: true }, { len: 43 }]}><Input.Password autoComplete="off" maxLength={43} /></Form.Item><Button htmlType="submit" loading={busy}>{t('确认邮箱')}</Button></Form></> : null}</section> : null}
    </Space> : null}
    <Typography.Paragraph><Link to="/login">{t('返回登录')}</Link></Typography.Paragraph>
  </Card></main>;
}
