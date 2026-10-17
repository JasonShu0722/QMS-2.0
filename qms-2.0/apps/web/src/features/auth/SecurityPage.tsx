import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, QRCode, Skeleton, Typography } from 'antd';
import { KeyRound, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import './security.css';

type SecurityStatus = components['schemas']['SecurityStatusDto'];
type Enrollment = components['schemas']['MfaEnrollmentDto'];
export type SecurityCloseState = { busy: boolean; hasSecrets: boolean };

async function securityPost<Result>(path: string, body?: components['schemas']['MfaCodeDto'] | components['schemas']['CompleteEmailVerificationDto']) {
  const token = await csrfToken();
  return apiRequest<Result>(`/api/v1/${path}`, { method: 'POST', headers: { 'x-csrf-token': token }, body: body ? JSON.stringify(body) : undefined });
}

export function SecurityContent({ embedded = false, onCloseStateChange }: { embedded?: boolean; onCloseStateChange?: (state: SecurityCloseState) => void }) {
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
  const pending = useRef(false);
  const [form] = Form.useForm();
  const [emailForm] = Form.useForm();
  useEffect(() => {
    let active = true;
    void apiRequest<SecurityStatus>('/api/v1/me/security').then((result) => { if (active) { setStatus(result); setError(undefined); } }).catch((cause) => { if (active) setError(cause); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => { onCloseStateChange?.({ busy, hasSecrets: !!enrollment || !!codes }); }, [busy, enrollment, codes, onCloseStateChange]);
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(cause); } finally { pending.current = false; setBusy(false); }
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
  return <div className="qms-security-content" aria-busy={busy}>
    <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} />
    {!status && !error ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
    {codes ? <section className="qms-security-section" aria-label={t('恢复码')}>
      <Alert type="warning" showIcon title={t('请离线保存恢复码，每个仅可使用一次。关闭后无法再次查看。')} />
      <pre className="qms-security-recovery-codes">{codes.join('\n')}</pre>
      <Button type="primary" onClick={() => { setCodes(undefined); if (!embedded && landingPath) navigate(landingPath, { replace: true }); }}>{t('已保存，继续')}</Button>
    </section> : status ? <>
      <section className="qms-security-policy" aria-label={t('登录验证')}>
        <span className="qms-security-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
        <div><h3>{t('登录验证')}</h3><Typography.Text strong>{t(status.mfaRequired ? '登录时要求 MFA' : '登录时不要求 MFA')}</Typography.Text><p>{t('MFA 策略由管理员在用户管理中统一设置。')}</p></div>
      </section>
      <section className="qms-security-section" aria-label={t('验证器')}>
        <div className="qms-security-section-heading"><Smartphone size={18} aria-hidden="true" /><h3>{t('验证器')}</h3><Typography.Text type="secondary">{t(status.mfaEnabled ? '验证器已绑定' : '验证器未绑定')}</Typography.Text></div>
        {enrollment ? <div className="qms-security-enrollment"><Typography.Paragraph>{t('使用验证器扫描二维码或手动输入密钥，然后输入验证码。')}</Typography.Paragraph><QRCode type="svg" value={enrollment.otpauthUri} /><Typography.Paragraph className="qms-security-secret" copyable>{enrollment.secret}</Typography.Paragraph><Typography.Text type="secondary">{t('有效期至')}: {new Date(enrollment.expiresAt).toLocaleString()}</Typography.Text></div> : null}
        {enrollment || status.securityState === 'MFA_REQUIRED' ? <Form form={form} layout="vertical" onFinish={verify} disabled={busy} className="qms-security-form"><Form.Item name="code" label={t('验证码或恢复码')} rules={[{ required: true }]}><Input autoFocus autoComplete="one-time-code" maxLength={43} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>{t('验证')}</Button></Form> : null}
        {!status.mfaEnabled && !enrollment ? <Button type="primary" loading={busy} onClick={() => void perform(async () => setEnrollment(await securityPost<Enrollment>('me/mfa/enrollment')))}>{t(status.securityState === 'AUTHENTICATED' ? '绑定验证器' : '启用 MFA')}</Button> : null}
      </section>
      {status.mfaEnabled && status.securityState === 'AUTHENTICATED' ? <section className="qms-security-section" aria-label={t('恢复码')}>
        <div className="qms-security-section-heading"><KeyRound size={18} aria-hidden="true" /><h3>{t('恢复码')}</h3><Typography.Text type="secondary">{t('剩余恢复码')}: {status.recoveryCodesRemaining}</Typography.Text></div>
        <p>{t('无法使用验证器时，可使用一次性恢复码登录。')}</p>
        <Button loading={busy} onClick={() => void perform(async () => { const result = await securityPost<components['schemas']['RecoveryCodesDto']>('me/mfa/recovery-codes'); setCodes(result.recoveryCodes); setRevision((value) => value + 1); })}>{t('重新生成恢复码')}</Button>
      </section> : null}
      {status.securityState === 'AUTHENTICATED' ? <section className="qms-security-section" aria-label={t('邮箱确认')}>
        <div className="qms-security-section-heading"><Mail size={18} aria-hidden="true" /><h3>{t('邮箱确认')}</h3>{status.emailVerifiedAt ? <Typography.Text type="secondary">{t('邮箱已确认')}</Typography.Text> : null}</div>
        {!status.emailVerifiedAt ? <p>{t('确认邮箱后可使用自助密码找回。')}</p> : null}
        {emailMessage ? <Alert type="success" role="status" title={t(emailMessage)} /> : null}
        {!status.emailVerifiedAt ? <><Button loading={busy} onClick={() => void perform(async () => { await securityPost('me/email-verification'); setEmailMessage('确认邮件已申请，请查看邮箱。'); })}>{t('发送确认邮件')}</Button><Form form={emailForm} layout="vertical" disabled={busy} className="qms-security-form" onFinish={(values: components['schemas']['CompleteEmailVerificationDto']) => void perform(async () => { await securityPost('auth/email-verification/complete', values); emailForm.resetFields(); setEmailMessage('邮箱已确认'); setRevision((value) => value + 1); })}><Form.Item name="token" label={t('邮件凭证')} rules={[{ required: true }, { len: 43 }]}><Input.Password autoComplete="off" maxLength={43} /></Form.Item><Button htmlType="submit" loading={busy}>{t('确认邮箱')}</Button></Form></> : null}
      </section> : null}
    </> : null}
  </div>;
}

export function SecurityPage() {
  const { t } = useLanguage();
  return <main className="security-page qms-security-page"><Card title={t('账号安全')}><SecurityContent /><Typography.Paragraph className="qms-security-back"><Link to="/login">{t('返回登录')}</Link></Typography.Paragraph></Card></main>;
}
