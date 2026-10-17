import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, List, Space, Tag, Typography } from 'antd';
import { changeAccountPassword, getAccountProfile, getAccountSessions, revokeAccountSession, updateAccountProfile } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../../i18n/Language';
import type { AccountProfile, AccountSession } from '@qms/contracts';

export function AccountCenterPage() {
  const { t, locale } = useLanguage();
  const location = useLocation();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [error, setError] = useState<unknown>();
  const [loaded, setLoaded] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  async function load() {
    setError(undefined);
    try {
      const [nextProfile, nextSessions] = await Promise.all([getAccountProfile(), getAccountSessions()]);
      setProfile(nextProfile);
      setSessions(nextSessions);
      profileForm.setFieldsValue({ email: nextProfile.email ?? '' });
      setLoaded(true);
    } catch (cause) {
      setError(cause); setLoaded(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (location.hash !== '#password' || !loaded) return;
    const target = document.getElementById('password');
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [loaded, location.hash]);

  async function saveProfile(values: { email?: string }) {
    setSaving(true); setError(undefined); setSuccess(undefined);
    try { setProfile(await updateAccountProfile({ email: values.email || null })); setSuccess('资料已保存'); }
    catch (cause) { setError(cause); }
    finally { setSaving(false); }
  }

  async function savePassword(values: { currentPassword: string; newPassword: string }) {
    setSaving(true); setError(undefined); setSuccess(undefined);
    try { await changeAccountPassword(values); passwordForm.resetFields(); setSuccess('密码已修改，其他会话已撤销'); await load(); }
    catch (cause) { setError(cause); }
    finally { setSaving(false); }
  }

  async function revoke(sessionId: string) {
    setError(undefined); setSuccess(undefined);
    try { await revokeAccountSession(sessionId); setSessions(await getAccountSessions()); setSuccess('会话已撤销'); }
    catch (cause) { setError(cause); }
  }

  return <section className="account-center">
    <Typography.Title level={2}>{t('个人账号')}</Typography.Title><Link to="/mfa">{t('账号安全')}</Link>
    <GovernanceFeedback error={error} retry={() => void load()} />
    {success ? <Alert type="success" showIcon title={t(success)} role="status" /> : null}
    <div className="account-grid">
      <Card title={t('基本信息')} loading={!profile && !error}>
        {profile ? <Space direction="vertical" size="small" className="account-summary">
          <Typography.Text strong>{profile.username}</Typography.Text>
          <Typography.Text type="secondary">{profile.organization.name} · {t(profile.accountType === 'INTERNAL' ? '内部账号' : '供应商账号')}</Typography.Text>
          <Tag color={profile.mfaEnabled ? 'green' : 'default'}>{t(profile.mfaEnabled ? 'MFA 已启用' : 'MFA 未启用')}</Tag>
        </Space> : null}
        <Form form={profileForm} layout="vertical" onFinish={saveProfile} className="account-form" disabled={!loaded || saving}>
          <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>{t('保存资料')}</Button>
        </Form>
      </Card>
      <Card id="password" tabIndex={-1} title={t('修改密码')}>
        <Form form={passwordForm} layout="vertical" onFinish={savePassword} className="account-form" disabled={!loaded || saving}>
          <Form.Item name="currentPassword" label={t('当前密码')} rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="newPassword" label={t('新密码')} rules={[{ required: true }, { min: 12, message: t('新密码至少 12 位') }]}><Input.Password /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>{t('修改密码')}</Button>
        </Form>
      </Card>
    </div>
    <Card title={t('登录会话')} className="account-sessions">
      <List dataSource={loaded ? sessions : []} locale={{ emptyText: loaded ? t('暂无会话') : error ? '—' : t('加载中') }} renderItem={(session) => <List.Item actions={session.isCurrent ? [<Tag key="current" color="blue">{t('当前会话')}</Tag>] : [<Button key="revoke" type="link" onClick={() => void revoke(session.id)}>{t('撤销')}</Button>]}>
        <List.Item.Meta title={`${t('登录于')} ${new Date(session.createdAt).toLocaleString(locale)}`} description={`${t('有效期至')} ${new Date(session.expiresAt).toLocaleString(locale)}`} />
      </List.Item>} />
    </Card>
  </section>;
}
