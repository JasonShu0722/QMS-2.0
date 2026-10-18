import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { getAccountProfile, getAccountSessions, revokeAccountSession, updateAccountProfile } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import type { AccountProfile, AccountSession } from '@qms/contracts';
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
  const { t, locale } = useLanguage();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [error, setError] = useState<unknown>();
  const [loaded, setLoaded] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [profileForm] = Form.useForm();
  const alive = useRef(false);
  const epoch = useRef(accountAvatarEpoch());
  const pending = useRef(false);
  const sessionPending = useRef(false);
  const profileInitialized = useRef(false);
  const loadId = useRef(0);
  const sessionLoadId = useRef(0);
  const securityTrigger = useRef<HTMLButtonElement>(null);
  const current = () => alive.current && epoch.current === accountAvatarEpoch();

  async function load() {
    const request = ++loadId.current;
    const sessionRequest = ++sessionLoadId.current;
    setError(undefined); setLoaded(false);
    try {
      const [nextProfile, nextSessions] = await Promise.all([getAccountProfile(), getAccountSessions()]);
      if (!current() || request !== loadId.current) return;
      publishAccountAvatar(nextProfile, epoch.current);
      setProfile(nextProfile);
      if (sessionRequest === sessionLoadId.current) { setSessions(nextSessions); setSessionsLoaded(true); }
      if (!profileInitialized.current) { profileForm.setFieldsValue({ email: nextProfile.email ?? '' }); profileInitialized.current = true; }
      setLoaded(true);
    } catch (cause) {
      if (current() && request === loadId.current) setError(cause);
    }
  }

  async function refreshSessions() {
    const request = ++sessionLoadId.current;
    setHistoryRevision(value => value + 1);
    const next = await getAccountSessions();
    if (current() && request === sessionLoadId.current) { setSessions(next); setSessionsLoaded(true); }
  }

  useEffect(() => {
    alive.current = true; void load();
    const refresh = () => { void refreshSessions().catch(cause => { if (current()) setError(cause); }); };
    window.addEventListener('qms:account-sessions-changed', refresh);
    return () => { alive.current = false; window.removeEventListener('qms:account-sessions-changed', refresh); };
  }, []);

  async function closeSecurity() {
    setSecurityOpen(false);
    try {
      const next = await getAccountProfile();
      if (current()) setProfile(previous => previous ? { ...previous, mfaEnabled: next.mfaEnabled } : previous);
    } catch (cause) { if (current()) setError(cause); }
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

  async function revoke(sessionId: string) {
    if (sessionPending.current) return;
    sessionPending.current = true; setRevoking(true); setError(undefined); setSuccess(undefined);
    try {
      await revokeAccountSession(sessionId);
      if (!current()) return;
      setSuccess('会话已撤销');
      await refreshSessions();
    } catch (cause) { if (current()) setError(cause); }
    finally { sessionPending.current = false; if (current()) setRevoking(false); }
  }

  return <section className="account-center">
    <Typography.Title level={2}>{t('个人账号')}</Typography.Title>
    <SecurityDialog open={securityOpen} onClose={() => void closeSecurity()} afterClose={() => securityTrigger.current?.focus()} />
    <GovernanceFeedback error={error} retry={error ? () => void load() : undefined} />
    {success ? <Alert type="success" showIcon title={t(success)} role="status" /> : null}
    <div className="qms-account-overview">
      <Card title={t('基本信息')} loading={!profile && !error}>
        {profile ? <div className="qms-account-identity"><AvatarEditor profile={profile} onChange={setProfile} /><div><Typography.Text strong>{profile.username}</Typography.Text><p>{profile.organization.name} · {t(profile.accountType === 'INTERNAL' ? '内部账号' : '供应商账号')}</p></div></div> : null}
        <Form form={profileForm} layout="vertical" onFinish={saveProfile} className="qms-account-profile-form" disabled={!loaded || saving}>
          <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input autoComplete="email" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>{t('保存资料')}</Button>
        </Form>
      </Card>
      <Card title={t('安全状态')} loading={!profile && !error}>
        {profile ? <Space orientation="vertical" size={12} className="qms-account-security-summary">
          <div><Typography.Text strong>{t('验证器')}</Typography.Text><Tag color={profile.mfaEnabled ? 'green' : 'default'}>{t(profile.mfaEnabled ? '验证器已绑定' : '验证器未绑定')}</Tag></div>
          <Typography.Text type="secondary">{t('管理登录验证与账号恢复方式')}</Typography.Text>
          <Button ref={securityTrigger} icon={<ShieldCheck size={16} />} onClick={() => setSecurityOpen(true)}>{t('账号安全')}</Button>
        </Space> : null}
      </Card>
    </div>
    <Card title={t('登录会话')} className="qms-account-sessions">
      {!sessionsLoaded ? <p>{error ? '—' : t('加载中')}</p> : sessions.length === 0 ? <p>{t('暂无会话')}</p> : <ul className="qms-account-session-list">{sessions.map(session => <li key={session.id}>
        <div><Typography.Text>{t('登录于')} {new Date(session.createdAt).toLocaleString(locale)}</Typography.Text><p>{t('有效期至')} {new Date(session.expiresAt).toLocaleString(locale)}</p></div>
        {session.isCurrent ? <Tag color="blue">{t('当前会话')}</Tag> : <Button type="link" disabled={revoking} onClick={() => void revoke(session.id)}>{t('撤销')}</Button>}
      </li>)}</ul>}
    </Card>
    <AccountSessionHistory revision={historyRevision} />
  </section>;
}
