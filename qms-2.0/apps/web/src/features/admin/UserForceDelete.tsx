import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, createAdminMutation, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { scopePath, type AdminUser } from './admin';

export type UserForceDeleteProps = {
  target: Pick<AdminUser, 'id' | 'organizationId' | 'username' | 'securityVersion'>;
  canDelete: boolean;
  onDeleted: () => void;
  onRefresh?: () => void;
  onDenied?: (error: ApiError) => void;
  disabled?: boolean;
  deletePath?: string;
};

type Command = components['schemas']['DeleteAdminUserDto'];
type Result = components['schemas']['AdminUserForceDeleteResultDto'];

export function UserForceDelete(props: UserForceDeleteProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return props.canDelete ? <DeleteScope key={JSON.stringify([session, props.target.organizationId, props.target.id, props.deletePath])} {...props} session={session} /> : null;
}

function DeleteScope({ target, disabled, onDeleted, onRefresh, onDenied, session, deletePath }: UserForceDeleteProps & { session?: string }) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const [baseline, setBaseline] = useState<UserForceDeleteProps['target']>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [invalidated, setInvalidated] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const attempt = useRef<{ path: string; body: Command } | undefined>(undefined);
  const mutate = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  useNavigationBusy(busy);
  useUnsavedChanges(unknown);
  function clearCommand() {
    attempt.current = undefined;
    mutate.current = createAdminMutation({ replayAfterReauthentication: false });
    setUnknown(false);
  }
  function invalidate() {
    generation.current++;
    controller.current?.abort();
    pending.current = false;
    clearCommand(); setBaseline(undefined); setError(undefined); setBusy(false);
  }
  useLayoutEffect(() => {
    alive.current = true;
    // Subscription aborts synchronously, including a principal change during CSRF acquisition.
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (state.sessionScope === session) return;
      alive.current = false; invalidate(); setInvalidated(true);
    });
    return () => { alive.current = false; generation.current++; controller.current?.abort(); attempt.current = undefined; unsubscribe(); };
  }, [session]);
  useLayoutEffect(() => { if (disabled) invalidate(); }, [disabled]);
  const current = (version: number) => alive.current && !invalidated && generation.current === version && useWorkTabsStore.getState().sessionScope === session;
  const validVersion = Number.isInteger(target.securityVersion) && target.securityVersion >= 1 && target.securityVersion <= 2147483647;

  function open() {
    if (disabled || pending.current || !validVersion || !current(generation.current)) return;
    requestLeave(() => {
      if (disabled || !current(generation.current)) return;
      if (!blocked) { clearCommand(); setError(undefined); }
      setBaseline({ ...target });
    });
  }
  function close() {
    if (pending.current) return;
    requestLeave(() => {
      if (!current(generation.current)) return;
      clearCommand(); setBaseline(undefined);
    });
  }
  function refresh() {
    if (pending.current || disabled || !onRefresh || !current(generation.current)) return;
    clearCommand(); setBlocked(false); setBaseline(undefined); setError(undefined); onRefresh();
  }
  async function confirm(retry = false) {
    const version = generation.current;
    if (!current(version) || disabled || pending.current || !baseline || blocked) return;
    if (retry ? !unknown || !attempt.current : unknown || !!error) return;
    const command = attempt.current ?? {
      path: deletePath ?? scopePath(`users/${encodeURIComponent(baseline.id)}`, baseline.organizationId),
      body: { expectedSecurityVersion: baseline.securityVersion },
    };
    attempt.current = command;
    pending.current = true; setBusy(true); setError(undefined);
    controller.current = new AbortController();
    let received = false;
    try {
      const value = await mutate.current<Result>(command.path, 'DELETE', command.body, controller.current.signal);
      received = true;
      if (!current(version)) return;
      if (value?.userId !== baseline.id || value.deleted !== true || !Array.isArray(value.effects)) throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: '删除结果无法核验' });
      clearCommand(); setBaseline(undefined); onDeleted();
    } catch (cause) {
      if (!current(version)) return;
      const denied = cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
      const reauthenticated = cause instanceof ApiError && cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED';
      const conflict = cause instanceof ApiError && cause.status === 409;
      const uncertain = !received && !denied && !conflict && (retry || !reauthenticated
        && (!(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408 || cause.status === 425));
      setError(cause);
      if (denied) { clearCommand(); setBaseline(undefined); onDenied?.(cause); }
      else if (uncertain) setUnknown(true);
      else {
        clearCommand();
        // A malformed 2xx has consumed the helper key: require refresh, never replay it as a new delete.
        if (conflict || received) setBlocked(true);
      }
    } finally {
      if (current(version)) { pending.current = false; setBusy(false); }
    }
  }
  const reauthenticated = error instanceof ApiError && error.code === 'CLIENT_REAUTHENTICATION_COMPLETED';
  return <>
    <Button size="small" danger disabled={disabled || busy || invalidated || !validVersion} onClick={open}>{t('永久删除用户')}</Button>
    <Modal title={t('永久删除用户')} open={!!baseline} onCancel={close} onOk={() => void confirm()} okText={t('确认永久删除')} cancelText={t('取消')} confirmLoading={busy} okButtonProps={{ danger: true, disabled: disabled || busy || unknown || blocked || !!error }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} destroyOnHidden footer={(_origin, { OkBtn, CancelBtn }) => <div className="qms-dialog-actions"><CancelBtn /><OkBtn /></div>}>
      {baseline && <>
        <Typography.Paragraph strong>{baseline.username}</Typography.Paragraph>
        <Alert type="warning" showIcon title={t('永久删除当前账号，不可通过启用恢复。')} description={t('撤销当前凭证和有效任职，解除当前配置；保留历史签章、审批、业务及审计记录，不改写原签署人。')} />
      </>}
      {!!error && <Alert type="error" showIcon title={t(reauthenticated ? unknown ? '身份验证已完成，原删除结果仍待核对，请重试原请求。' : '身份验证已完成，请取消后重新确认删除。' : safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} />}
      {unknown && <><Alert type="warning" showIcon title={t('删除结果尚未确认，将使用原请求重试，不会创建新的删除操作。')} /><Button disabled={disabled || busy} loading={busy} onClick={() => void confirm(true)}>{t('重试确认结果')}</Button></>}
      {blocked && <><Alert type="warning" showIcon title={t('账号版本已变化或删除结果无法核验，请刷新账号后重新确认。')} /><Button disabled={disabled || busy || !onRefresh} onClick={refresh}>{t('刷新账号后重新确认')}</Button></>}
    </Modal>
  </>;
}
