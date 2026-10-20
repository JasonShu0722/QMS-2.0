import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { getAccountOverview, getAccountProfile } from '../../api/client';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import type { AccountProfile, components } from '@qms/contracts';
import { ShieldCheck } from 'lucide-react';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SecurityDialog } from '../auth/SecurityDialog';
import { AccountAvatar } from './AccountAvatar';
import { AccountSettingsDialog } from './AccountSettingsDialog';
import { accountAvatarEpoch, publishAccountAvatar, useAccountAvatar } from './account-avatar-state';
import { AccountSessionHistory } from './AccountSessionHistory';
import './account.css';

type Overview = components['schemas']['AccountOverviewDto'];
export function AccountCenterPage() {
  const scope = useWorkTabsStore(state => state.sessionScope);
  useAccountAvatar();
  return <AccountCenterContent key={`${scope}:${accountAvatarEpoch()}`} />;
}
function AccountCenterContent() {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<AccountProfile>();
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<unknown>();
  const [overviewError, setOverviewError] = useState<unknown>();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(accountAvatarEpoch());
  const loadId = useRef(0);
  const overviewId = useRef(0);
  const securityVersion = useRef(0);
  const securityTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const current = () => alive.current && epoch.current === accountAvatarEpoch();
  async function load() {
    const request = ++loadId.current;
    const securityRequest = securityVersion.current;
    setError(undefined);
    try {
      const next = await getAccountProfile();
      if (!current() || request !== loadId.current) return;
      publishAccountAvatar(next, epoch.current);
      setProfile(previous => previous && securityRequest !== securityVersion.current ? { ...next, mfaEnabled: previous.mfaEnabled, emailVerifiedAt: previous.emailVerifiedAt } : next);
    } catch (cause) { if (current() && request === loadId.current) setError(cause); }
  }
  async function loadOverview() {
    const request = ++overviewId.current;
    setOverview(undefined); setOverviewError(undefined);
    try { const next = await getAccountOverview(); if (current() && request === overviewId.current) setOverview(next); }
    catch (cause) { if (current() && request === overviewId.current) setOverviewError(cause); }
  }
  useEffect(() => {
    alive.current = true; void load(); void loadOverview();
    return () => { alive.current = false; loadId.current += 1; overviewId.current += 1; securityVersion.current += 1; };
  }, []);
  async function refreshSecurity() {
    const request = ++securityVersion.current;
    setError(undefined);
    try {
      const next = await getAccountProfile();
      if (current() && request === securityVersion.current) {
        securityVersion.current += 1;
        setProfile(previous => previous ? { ...previous, mfaEnabled: next.mfaEnabled, emailVerifiedAt: previous.email === next.email ? next.emailVerifiedAt : previous.emailVerifiedAt } : previous);
      }
    } catch (cause) { if (current() && request === securityVersion.current) setError(cause); }
  }
  function acceptProfile(next: AccountProfile) {
    if (!current()) return;
    // A settings write supersedes full reads, but never rewinds a newer security refresh.
    loadId.current += 1;
    setProfile(previous => previous ? { ...previous, fullName: next.fullName, phone: next.phone, email: next.email, emailVerifiedAt: next.emailVerifiedAt, profileVersion: next.profileVersion } : next);
  }
  function acceptAvatar(next: AccountProfile) {
    if (current()) setProfile(previous => previous ? { ...previous, avatarFileId: next.avatarFileId, avatarVersion: next.avatarVersion } : previous);
  }
  return <section className="account-center">
    <Typography.Title level={2}>{t('个人账号')}</Typography.Title>
    <SecurityDialog open={securityOpen} onClose={() => { setSecurityOpen(false); void refreshSecurity(); }} afterClose={() => securityTrigger.current?.focus()} />
    {profile && settingsOpen && <AccountSettingsDialog profile={profile} overview={overview} onProfile={acceptProfile} onAvatar={acceptAvatar} onClose={() => setSettingsOpen(false)} afterClose={() => settingsTrigger.current?.focus()} />}
    <GovernanceFeedback error={error} retry={error ? () => void (profile ? refreshSecurity() : load()) : undefined} />
    <Card title={t('账号概览')} loading={!profile && !error} extra={<Button ref={settingsTrigger} disabled={!profile} onClick={() => setSettingsOpen(true)}>{t('个人信息设置')}</Button>}>
      {profile && <div className="qms-account-overview">
        <section className="qms-account-identity" aria-label={t('身份资料')}>
          <div className="qms-account-avatar-heading"><AccountAvatar profile={profile} size={76} /><div><Typography.Text strong>{profile.fullName || profile.username}</Typography.Text>{profile.fullName && <p>{profile.username}</p>}<p>{profile.organization.name} · {t(profile.accountType === 'INTERNAL' ? '内部账号' : '供应商账号')}</p></div></div>
          <Descriptions size="small" column={1} items={[{ key: 'name', label: t('姓名'), children: profile.fullName || t('未填写') }, { key: 'phone', label: t('电话'), children: profile.phone || t('未填写') }]} />
          {overview ? overview.assignments.length ? <details open={overview.assignments.length <= 2}><summary>{t('当前任职')}</summary>{overview.assignments.map(item => <p key={item.id}>{item.department.name} · {item.position.name}</p>)}</details> : <p>{t('暂无当前任职')}</p> : overviewError ? <Alert type="error" title={t('任职与授权加载失败')} action={<Button onClick={() => void loadOverview()}>{t('重试')}</Button>} /> : <p role="status">{t('正在加载任职与授权')}</p>}
        </section>
        <section className="qms-account-security-summary" aria-label={t('账号与授权')}>
          <Descriptions size="small" column={1} items={[
            { key: 'status', label: t('账号状态'), children: <Tag color={profile.status === 'ACTIVE' ? 'green' : 'default'}>{t(profile.status === 'ACTIVE' ? '启用' : '停用')}</Tag> },
            { key: 'email', label: t('邮箱'), children: <>{profile.email || t('未填写')} · {t(profile.emailVerifiedAt ? '邮箱已确认' : '邮箱未确认')}</> },
            { key: 'mfa', label: t('验证器'), children: <Tag color={profile.mfaEnabled ? 'green' : 'default'}>{t(profile.mfaEnabled ? '验证器已绑定' : '验证器未绑定')}</Tag> },
          ]} />
          {overview && <><p>{t('有效角色')} · {overview.effectiveRoles.length} / {t('有效权限')} · {new Set(overview.permissions).size}</p><details><summary>{t('角色与权限来源')}</summary>{overview.effectiveRoles.map(role => <div key={role.id}><Typography.Text strong>{role.name}</Typography.Text>{role.sources.map((source, index) => <p key={index}>{source.kind === 'DIRECT' ? t('直接分配') : `${t('岗位继承')} · ${source.positionName || source.positionId || t('未知岗位')}`}</p>)}</div>)}{!overview.effectiveRoles.length && <p>{t('暂无有效角色')}</p>}{[...new Set(overview.permissions)].map(code => <Tag key={code}>{code}</Tag>)}</details></>}
          {!overview && <Typography.Text type="secondary">{t('授权摘要不可用')}</Typography.Text>}
          <Space wrap><Button ref={securityTrigger} icon={<ShieldCheck size={16} />} onClick={() => setSecurityOpen(true)}>{t('账号安全')}</Button></Space>
        </section>
      </div>}
      {!profile && !!error && <Alert type="info" title={t('账号资料不可用')} />}
    </Card>
    <AccountSessionHistory />
  </section>;
}
