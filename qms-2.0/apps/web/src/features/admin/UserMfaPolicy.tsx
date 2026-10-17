import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Popconfirm, Skeleton, Space, Switch, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { scopePath, type AdminUser } from './admin';

type MfaPolicy = components['schemas']['AdminMfaPolicyDto'];
type MfaPolicyInput = components['schemas']['AdminMfaPolicyInputDto'];

export function UserMfaPolicy({ user, organizationId, canWrite, onSaved, onClose }: {
  user: AdminUser; organizationId: string; canWrite: boolean; onSaved: () => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<MfaPolicy>();
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const mutation = useRef<{ signature: string; key: string } | undefined>(undefined);
  const path = scopePath(`users/${user.id}/mfa-policy`, organizationId);

  function failure(cause: unknown) {
    setError(safeAccountError(cause));
    setTraceId(cause instanceof ApiError ? cause.traceId : undefined);
  }
  async function load(preserveDraft = false) {
    setLoading(true); setError(undefined); setTraceId(undefined);
    try {
      const result = await apiRequest<MfaPolicy>(path);
      if (alive.current) {
        setPolicy(result); setConflict(false);
        if (!preserveDraft) setRequired(result.required);
      }
    } catch (cause) { if (alive.current) failure(cause); }
    finally { if (alive.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, []);

  async function save() {
    if (!policy || !canWrite || pending.current || loading || conflict) return;
    pending.current = true; setBusy(true); setError(undefined); setTraceId(undefined);
    const body: MfaPolicyInput = { required, expectedSecurityVersion: policy.securityVersion };
    const signature = JSON.stringify(body);
    if (mutation.current?.signature !== signature) mutation.current = { signature, key: crypto.randomUUID() };
    try {
      const token = await csrfToken();
      if (!alive.current) return;
      const result = await apiRequest<MfaPolicy>(path, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': mutation.current.key }, body: signature });
      if (!alive.current) return;
      mutation.current = undefined;
      if (result.selfSessionRevoked) {
        useWorkTabsStore.getState().reset();
        navigate('/login', { replace: true });
        return;
      }
      setPolicy(result); setRequired(result.required); onSaved();
      await load();
    } catch (cause) {
      if (alive.current) {
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true); setError('设置已更新，请重新加载后再保存。当前选择会保留。');
          setTraceId(cause.traceId);
        } else failure(cause);
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function close() {
    if (pending.current) return;
    if (policy && required !== policy.required) setDiscard(true);
    else onClose();
  }
  return <>
    <Modal title={`${user.username} · ${t('MFA 设置')}`} open onCancel={close} footer={null} width={480} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} destroyOnHidden>
      <Space orientation="vertical" className="admin-form-stack">
        {error && <Alert type="error" showIcon title={t(error)} description={traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined} />}
        {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : policy && <>
          <Descriptions column={1} size="small" items={[
            { key: 'required', label: t('MFA 生效状态'), children: <Tag color={policy.required ? 'green' : 'default'}>{t(policy.required ? '启用' : '停用')}</Tag> },
            { key: 'bound', label: t('验证器绑定'), children: t(policy.bound ? '已绑定' : '未绑定') },
            { key: 'source', label: t('策略来源'), children: t(policy.override === null ? '默认策略' : '账号配置') },
            { key: 'role', label: t('角色要求 MFA'), children: t(policy.roleRequired ? '是' : '否') },
          ]} />
          {!canWrite && <Alert type="info" showIcon title={t('没有重置用户权限，仅可查看 MFA 设置。')} />}
          <Space><Typography.Text>{t('要求 MFA')}</Typography.Text><Switch aria-label={t('要求 MFA')} checked={required} onChange={setRequired} disabled={!canWrite || busy || conflict} /></Space>
          {canWrite && <Popconfirm title={t('确认保存 MFA 设置？')} description={t('保存后将撤销此账号的全部会话和未完成验证，保留验证器绑定。修改当前账号需要重新登录。')} okText={t('确认保存')} cancelText={t('取消')} onConfirm={save} disabled={busy || conflict}>
            <Button type="primary" disabled={busy || conflict} loading={busy}>{t('保存 MFA 设置')}</Button>
          </Popconfirm>}
        </>}
        {!loading && error && <Button disabled={busy} onClick={() => void load(!!policy)}>{t('重新加载 MFA 设置')}</Button>}
      </Space>
    </Modal>
    <Modal title={t('放弃未保存的修改？')} open={discard} onCancel={() => setDiscard(false)} onOk={onClose} okText={t('放弃修改并关闭')} cancelText={t('取消')}>
      {t('当前修改尚未保存。')}
    </Modal>
  </>;
}
