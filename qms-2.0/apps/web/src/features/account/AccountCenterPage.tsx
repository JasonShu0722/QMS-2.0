import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, List, Space, Tag, Typography } from 'antd';
import { ApiError, changeAccountPassword, getAccountProfile, getAccountSessions, revokeAccountSession, updateAccountProfile } from '../../api/client';
import type { AccountProfile, AccountSession } from '@qms/contracts';

export function AccountCenterPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  async function load() {
    try {
      const [nextProfile, nextSessions] = await Promise.all([getAccountProfile(), getAccountSessions()]);
      setProfile(nextProfile);
      setSessions(nextSessions);
      profileForm.setFieldsValue({ email: nextProfile.email ?? '' });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '账号信息加载失败');
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveProfile(values: { email?: string }) {
    setSaving(true); setError(undefined);
    try { setProfile(await updateAccountProfile({ email: values.email || null })); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '账号信息保存失败'); }
    finally { setSaving(false); }
  }

  async function savePassword(values: { currentPassword: string; newPassword: string }) {
    setSaving(true); setError(undefined);
    try { await changeAccountPassword(values); passwordForm.resetFields(); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '密码修改失败'); }
    finally { setSaving(false); }
  }

  async function revoke(sessionId: string) {
    setError(undefined);
    try { await revokeAccountSession(sessionId); setSessions(await getAccountSessions()); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '会话撤销失败'); }
  }

  return <section className="account-center">
    <Typography.Title level={2}>个人账号</Typography.Title>
    {error ? <Alert type="error" showIcon message={error} /> : null}
    <div className="account-grid">
      <Card title="基本信息" loading={!profile}>
        {profile ? <Space direction="vertical" size="small" className="account-summary">
          <Typography.Text strong>{profile.username}</Typography.Text>
          <Typography.Text type="secondary">{profile.organization.name} · {profile.accountType === 'INTERNAL' ? '内部账号' : '供应商账号'}</Typography.Text>
          <Tag color={profile.mfaEnabled ? 'green' : 'default'}>{profile.mfaEnabled ? 'MFA 已启用' : 'MFA 未启用'}</Tag>
        </Space> : null}
        <Form form={profileForm} layout="vertical" onFinish={saveProfile} className="account-form">
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>保存资料</Button>
        </Form>
      </Card>
      <Card title="修改密码">
        <Form form={passwordForm} layout="vertical" onFinish={savePassword} className="account-form">
          <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true }, { min: 12, message: '新密码至少 12 位' }]}><Input.Password /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>修改密码</Button>
        </Form>
      </Card>
    </div>
    <Card title="登录会话" className="account-sessions">
      <List dataSource={sessions} locale={{ emptyText: '暂无会话' }} renderItem={(session) => <List.Item actions={session.isCurrent ? [<Tag key="current" color="blue">当前会话</Tag>] : [<Button key="revoke" type="link" onClick={() => void revoke(session.id)}>撤销</Button>]}>
        <List.Item.Meta title={`登录于 ${new Date(session.createdAt).toLocaleString()}`} description={`有效期至 ${new Date(session.expiresAt).toLocaleString()}`} />
      </List.Item>} />
    </Card>
  </section>;
}
