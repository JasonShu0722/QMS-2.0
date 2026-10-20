import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Spin, Typography } from 'antd';
import type { AccountProfile, components } from '@qms/contracts';
import { ApiError, getMySignatureSummary, registerMySignature, revokeMySignature, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { accountAvatarEpoch } from './account-avatar-state';

type Summary = components['schemas']['ESignatureSummaryDto'];
type Registration = components['schemas']['RegisterESignatureDto'];
export function SignatureSettings({ accountType, permissions, disabled = false, onStateChange }: { accountType: AccountProfile['accountType']; permissions?: string[]; disabled?: boolean; onStateChange?: (state: { busy: boolean; dirty: boolean }) => void }) {
  const { t, locale } = useLanguage();
  const allowed = accountType === 'INTERNAL' && !!permissions?.includes('e-signature:signatures:read');
  const canWrite = allowed && !!permissions?.includes('e-signature:signatures:write');
  const [form] = Form.useForm<Registration>();
  const [items, setItems] = useState<Summary[]>();
  const [error, setError] = useState<unknown>();
  const [writeError, setWriteError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const lifetime = useRef(new AbortController());
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string }>(undefined);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); attempt.current = undefined; };
  }, []);
  useEffect(() => { onStateChange?.({ busy, dirty }); }, [busy, dirty, onStateChange]);
  useEffect(() => {
    const request = ++generation.current;
    const epoch = accountAvatarEpoch();
    const controller = new AbortController();
    setItems(undefined); setError(undefined);
    if (allowed) void getMySignatureSummary(controller.signal).then(next => { if (!controller.signal.aborted && request === generation.current && epoch === accountAvatarEpoch()) { setItems(next); setConflict(false); setWriteError(undefined); } }).catch(cause => { if (!controller.signal.aborted && request === generation.current && epoch === accountAvatarEpoch()) setError(cause); });
    return () => { controller.abort(); generation.current += 1; };
  }, [allowed, revision]);
  async function write(values: Registration | Summary) {
    if (!canWrite || disabled || pending.current || conflict) return;
    pending.current = true; setBusy(true); setWriteError(undefined); setSuccess(undefined);
    const signal = lifetime.current.signal;
    const epoch = accountAvatarEpoch();
    const isCurrent = () => !signal.aborted && epoch === accountAvatarEpoch();
    const body = 'id' in values ? { expectedVersion: values.version } : { label: values.label.trim(), signatureData: values.signatureData };
    const payload = JSON.stringify(['id' in values ? values.id : 'register', body]);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try {
      if ('id' in values) await revokeMySignature(values.id, { expectedVersion: values.version }, attempt.current.key, signal);
      else await registerMySignature({ label: values.label.trim(), signatureData: values.signatureData }, attempt.current.key, signal);
      if (!isCurrent()) return;
      attempt.current = undefined;
      if (!('id' in values)) { form.resetFields(); setDirty(false); }
      setSuccess('id' in values ? '签名已撤销' : '签名已登记');
      setRevision(value => value + 1);
    } catch (cause) {
      if (isCurrent()) {
        setWriteError(cause);
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      }
    } finally { if (isCurrent()) { pending.current = false; setBusy(false); } }
  }
  const unavailable = !allowed || (error instanceof ApiError && error.status === 403);
  return <section aria-label={t('签名摘要')}>
    <Typography.Title level={5}>{t('签名摘要')}</Typography.Title>
    <p>{t('仅生成签名指纹，不保存原文')}</p>
    {success && <Alert type="success" title={t(success)} role="status" />}
    {!!writeError && <Alert type="error" title={t(conflict ? '记录已被其他用户更新，请刷新后重试' : safeAccountError(writeError))} />}
    {allowed && <Button disabled={busy || disabled} onClick={() => setRevision(value => value + 1)}>{t('刷新签名摘要')}</Button>}
    {unavailable ? <p>{t('签名不可用')}</p> : error ? <Alert type="error" title={t('签名摘要加载失败')} action={<Button onClick={() => setRevision(value => value + 1)}>{t('重试')}</Button>} /> : !items ? <Spin aria-label={t('正在加载签名摘要')} /> : !items.length ? <p>{t('暂无签名')}</p> : items.map(item => <Descriptions key={item.id} size="small" column={1} items={[
      { key: 'label', label: t('签名标签'), children: item.label },
      { key: 'status', label: t('状态'), children: t(item.status === 'ACTIVE' ? '有效' : '已撤销') },
      { key: 'created', label: t('创建时间'), children: new Date(item.createdAt).toLocaleString(locale) },
      ...(item.revokedAt ? [{ key: 'revoked', label: t('撤销时间'), children: new Date(item.revokedAt).toLocaleString(locale) }] : []),
      ...(canWrite && item.status === 'ACTIVE' ? [{ key: 'action', label: t('操作'), children: <Button aria-label={`${t('撤销签名')} ${item.label}`} danger disabled={busy || disabled || conflict} onClick={() => void write(item)}>{t('撤销签名')}</Button> }] : []),
    ]} />)}
    {canWrite && !unavailable && <Form form={form} name="account-signature" layout="vertical" preserve={false} clearOnDestroy disabled={busy || disabled} onValuesChange={() => setDirty(!!form.getFieldValue('label') || !!form.getFieldValue('signatureData'))} onFinish={write}>
      <Form.Item name="label" label={t('签名标签')} rules={[{ required: true, whitespace: true }, { max: 120 }]}><Input autoComplete="off" /></Form.Item>
      <Form.Item name="signatureData" label={t('签名原文')} rules={[{ required: true, whitespace: true }, { min: 16, max: 100000 }]}><Input.TextArea autoComplete="off" rows={3} /></Form.Item>
      <Button type="primary" htmlType="submit" disabled={busy || disabled || conflict} loading={busy}>{t('登记签名')}</Button>
    </Form>}
  </section>;
}
