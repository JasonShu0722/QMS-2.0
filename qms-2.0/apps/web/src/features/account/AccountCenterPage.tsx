import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { getAccountProfile, updateAccountProfile } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import type { AccountProfile } from '@qms/contracts';
import { ShieldCheck } from 'lucide-react';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SecurityDialog } from '../auth/SecurityDialog';
import { AvatarEditor } from './AvatarEditor';
import { accountAvatarEpoch, publishAccountAvatar, useAccountAvatar } from './account-avatar-state';
import { AccountSessionHistory } from './AccountSessionHistory';
import './account.css';

export function AccountCenterPage() {
  const scope = useWorkTabsStore(state => state.sessionScope);
  useAccountAvatar();
  return <AccountCenterContent key={`${scope}:${accountAvatarEpoch()}`} />;
}

function AccountCenterContent() {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [error, setError] = useState<unknown>();
  const [loaded, setLoaded] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [profileForm] = Form.useForm();
  const alive = useRef(false);
  const epoch = useRef(accountAvatarEpoch());
  const pending = useRef(false);
  const profileInitialized = useRef(false);
  const loadId = useRef(0);
  const securityVersion = useRef(0);
  const securityTrigger = useRef<HTMLButtonElement>(null);
  const current = () => alive.current && epoch.current === accountAvatarEpoch();

  async function load() {
    const request = ++loadId.current;
    const securityRequest = securityVersion.current;
    setError(undefined); setLoaded(false);
    try {
      const nextProfile = await getAccountProfile();
      if (!current() || request !== loadId.current) return;
      publishAccountAvatar(nextProfile, epoch.current);
      setProfile(previous => previous && securityRequest !== securityVersion.current ? { ...nextProfile, mfaEnabled: previous.mfaEnabled } : nextProfile);
      if (!profileInitialized.current) { profileForm.setFieldsValue({ email: nextProfile.email ?? '' }); profileInitialized.current = true; }
      setLoaded(true);
    } catch (cause) {
      if (current() && request === loadId.current) setError(cause);
    }
  }

  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; loadId.current += 1; securityVersion.current += 1; };
  }, []);

  async function closeSecurity() {
    setSecurityOpen(false);
    const request = ++securityVersion.current;
    try {
      const next = await getAccountProfile();
      if (current() && request === securityVersion.current) {
        // Also protect full reads started while this security refresh was pending.
        securityVersion.current += 1;
        setProfile(previous => previous ? { ...previous, mfaEnabled: next.mfaEnabled } : previous);
      }
    } catch (cause) { if (current() && request === securityVersion.current) setError(cause); }
  }

  async function saveProfile(values: { email?: string }) {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError(undefined); setSuccess(undefined);
    try {
      const next = await updateAccountProfile({ email: values.email || null });
      if (current()) { setProfile(next); setSuccess('资料已保存'); }
    } catch (cause) { if (current()) setError(cause); }
    finally { pending.current = false; if (current()) setSaving(false); }
  }

  return <section className="account-center">
    <Typography.Title level={2}>{t('个人账号')}</Typography.Title>
    <SecurityDialog open={securityOpen} onClose={() => void closeSecurity()} afterClose={() => securityTrigger.current?.focus()} />
    <GovernanceFeedback error={error} retry={error ? () => void load() : undefined} />
    {success ? <Alert type="success" showIcon title={t(success)} role="status" /> : null}
    <Card title={t('账号概览')} loading={!profile && !error}>
      <div className="qms-account-overview">
        {profile ? <div className="qms-account-identity"><AvatarEditor profile={profile} onChange={setProfile}><div><Typography.Text strong>{profile.username}</Typography.Text><p>{profile.organization.name} · {t(profile.accountType === 'INTERNAL' ? '内部账号' : '供应商账号')}</p></div></AvatarEditor></div> : null}
        <Form form={profileForm} layout="vertical" onFinish={saveProfile} className="qms-account-profile-form" disabled={!loaded || saving}>
          <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input autoComplete="email" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>{t('保存资料')}</Button>
        </Form>
        {profile ? <Space orientation="vertical" size={6} className="qms-account-security-summary">
          <div><Typography.Text strong>{t('验证器')}</Typography.Text><Tag color={profile.mfaEnabled ? 'green' : 'default'}>{t(profile.mfaEnabled ? '验证器已绑定' : '验证器未绑定')}</Tag></div>
          <Typography.Text type="secondary">{t('管理登录验证与账号恢复方式')}</Typography.Text>
          <Button ref={securityTrigger} icon={<ShieldCheck size={16} />} onClick={() => setSecurityOpen(true)}>{t('账号安全')}</Button>
        </Space> : null}
      </div>
    </Card>
    <AccountSessionHistory />
  </section>;
}
