import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Typography } from 'antd';
import type { AccountProfile, components } from '@qms/contracts';
import { ApiError, getAccountProfile, updateAccountProfile } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { AvatarEditor } from './AvatarEditor';
import { accountAvatarEpoch } from './account-avatar-state';
import { SignatureSettings } from './SignatureSettings';

type Overview = components['schemas']['AccountOverviewDto'];
type Draft = Pick<components['schemas']['UpdateAccountProfileDto'], 'fullName' | 'phone' | 'email'>;
const fields = (profile: AccountProfile): Draft => ({ fullName: profile.fullName ?? '', phone: profile.phone ?? '', email: profile.email ?? '' });
export function AccountSettingsDialog({ profile, overview, onProfile, onAvatar, onClose, afterClose }: { profile: AccountProfile; overview?: Overview; onProfile: (value: AccountProfile) => void; onAvatar: (value: AccountProfile) => void; onClose: () => void; afterClose: () => void }) {
  const { t } = useLanguage();
  const [form] = Form.useForm<Draft>();
  const [baseline, setBaseline] = useState(profile);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarState, setAvatarState] = useState({ busy: false, dirty: false });
  const [signatureState, setSignatureState] = useState({ busy: false, dirty: false });
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const epoch = useRef(accountAvatarEpoch());
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string }>(undefined);
  const busy = saving || avatarState.busy || signatureState.busy;
  useUnsavedChanges(dirty || avatarState.dirty || signatureState.dirty);
  useNavigationBusy(busy);
  const requestLeave = useNavigationGuard();
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
  const current = (request: number) => alive.current && request === generation.current && epoch.current === accountAvatarEpoch();
  async function save(values: Draft) {
    if (pending.current || avatarState.busy || signatureState.busy || conflict) return;
    pending.current = true; setSaving(true); setError(undefined); setSuccess(false);
    const request = ++generation.current;
    const body: components['schemas']['UpdateAccountProfileDto'] = { fullName: values.fullName?.trim() || null, phone: values.phone?.trim() || null, email: values.email?.trim() || null, expectedProfileVersion: baseline.profileVersion };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try {
      const next = await updateAccountProfile(body, attempt.current.key);
      if (!current(request)) return;
      attempt.current = undefined; setBaseline(next); form.setFieldsValue(fields(next)); setDirty(false); setSuccess(true); onProfile(next);
    } catch (cause) { if (current(request)) { setError(cause); if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'CONCURRENCY_CONFLICT')) setConflict(true); } }
    finally { if (current(request)) { pending.current = false; setSaving(false); } }
  }
  async function reloadBaseline() {
    if (pending.current || avatarState.busy || signatureState.busy) return;
    const draft = form.getFieldsValue();
    const previous = fields(baseline);
    pending.current = true; setSaving(true);
    const request = ++generation.current;
    try {
      const next = await getAccountProfile();
      if (!current(request) || next.id !== profile.id) return;
      const latest = fields(next);
      const merged = { ...latest };
      for (const field of ['fullName', 'phone', 'email'] as const) {
        if ((draft[field]?.trim() || null) !== (previous[field]?.trim() || null)) merged[field] = draft[field];
      }
      form.setFieldsValue(merged);
      setDirty((['fullName', 'phone', 'email'] as const).some(field => (merged[field]?.trim() || null) !== (latest[field]?.trim() || null)));
      setBaseline(next); setConflict(false); setError(undefined); attempt.current = undefined;
    } catch (cause) { if (current(request)) setError(cause); }
    finally { if (current(request)) { pending.current = false; setSaving(false); } }
  }
  function close() { if (!pending.current && !avatarState.busy && !signatureState.busy) requestLeave(() => setOpen(false), true); }
  return <Modal open={open} title={t('个人信息设置')} width={680} destroyOnHidden onCancel={close} afterClose={() => { onClose(); afterClose(); }} keyboard={!busy} closable={!busy} mask={{ closable: !busy }} footer={<div className="qms-dialog-actions" role="group" aria-label={t('个人信息设置')}><Button aria-label={t('关闭个人信息设置')} disabled={busy} onClick={close}>{t('关闭')}</Button></div>} className="qms-account-settings">
    <GovernanceFeedback error={error} />
    {conflict && <Button disabled={busy} onClick={() => void reloadBaseline()}>{t('读取最新资料基线')}</Button>}
    {success && <Alert type="success" title={t('资料已保存')} role="status" />}
    <Form form={form} initialValues={fields(profile)} layout="vertical" disabled={busy} preserve={false} onFinish={save} onValuesChange={() => { setDirty(JSON.stringify(form.getFieldsValue()) !== JSON.stringify(fields(baseline))); setSuccess(false); }}>
      <Form.Item name="fullName" label={t('姓名')} rules={[{ max: 100 }]}><Input autoComplete="name" /></Form.Item>
      <Form.Item name="phone" label={t('电话')} rules={[{ max: 40 }]}><Input autoComplete="tel" /></Form.Item>
      <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input autoComplete="email" /></Form.Item>
      <Button type="primary" htmlType="submit" disabled={conflict} loading={saving}>{t('保存资料')}</Button>
    </Form>
    <Typography.Title level={5}>{t('头像')}</Typography.Title>
    <AvatarEditor profile={profile} onChange={onAvatar} disabled={saving || signatureState.busy} onStateChange={setAvatarState} />
    <Typography.Title level={5}>{t('当前任职（只读）')}</Typography.Title>
    {overview ? overview.assignments.length ? overview.assignments.map(item => <p key={item.id}>{item.department?.name ?? t('组织直属')} · {item.position.name}<br /><Typography.Text type="secondary">{item.startedAt} · {item.endedAt ?? t('至今')}</Typography.Text></p>) : <p>{t('暂无当前任职')}</p> : <p>{t('任职资料不可用')}</p>}
    {open && <SignatureSettings accountType={profile.accountType} permissions={overview?.permissions} disabled={saving || avatarState.busy} onStateChange={setSignatureState} />}
  </Modal>;
}
