import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { GovernanceFeedback } from './GovernanceFeedback';

type Preview = components['schemas']['OrganizationForceDeletePreviewDto'];
type Result = components['schemas']['OrganizationForceDeleteResultDto'];
type Command = components['schemas']['OrganizationForceDeleteDto'];
export type AdministrativeForceDeleteDialogProps = {
  path: string;
  kind: Preview['kind'];
  target: { id: string; name: string; code: string; version: number };
  scopeKey: string;
  allowed: boolean;
  disabled?: boolean;
  onBeforeOpen?: () => void;
  onDeleted: (result: Result) => void;
  onDenied?: (error: ApiError) => void;
};

export function AdministrativeForceDeleteDialog(props: AdministrativeForceDeleteDialogProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return props.allowed ? <ForceDeleteScope key={JSON.stringify([session, props.scopeKey, props.path, props.kind, props.target.id, props.target.version])} {...props} session={session} /> : null;
}

function ForceDeleteScope({ path, kind, target, disabled, onBeforeOpen, onDeleted, onDenied, session }: AdministrativeForceDeleteDialogProps & { session?: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<unknown>();
  const [expired, setExpired] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const alive = useRef(false);
  const invalidated = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const reading = useRef<AbortController | undefined>(undefined);
  const writing = useRef<AbortController | undefined>(undefined);
  const attempt = useRef<Command | undefined>(undefined);
  const mutate = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  useNavigationBusy(busy);
  useUnsavedChanges(unknown);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      if (invalidated.current) return;
      // Observe every store transition: React can batch A -> B -> A into one render.
      invalidated.current = true; generation.current++;
      reading.current?.abort(); writing.current?.abort(); attempt.current = undefined;
      mutate.current = createAdminMutation({ replayAfterReauthentication: false });
      setExpired(true); setOpen(false); setPreview(undefined); setError(undefined); setUnknown(false); setChecking(false); setBusy(false);
    };
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) invalidate(); });
    if (useWorkTabsStore.getState().sessionScope !== session) invalidate();
    return () => { unsubscribe(); alive.current = false; generation.current++; reading.current?.abort(); writing.current?.abort(); attempt.current = undefined; };
  }, [session]);
  const current = (request: number) => alive.current && !invalidated.current && generation.current === request && session === useWorkTabsStore.getState().sessionScope;
  function clearCommand() { attempt.current = undefined; mutate.current = createAdminMutation({ replayAfterReauthentication: false }); setUnknown(false); }
  function fail(cause: unknown, preserveCommand = false) {
    setError(cause);
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' && !preserveCommand)) {
      setPreview(undefined); clearCommand();
      if (cause.status === 401 || cause.status === 403) onDenied?.(cause);
      if (cause.status === 401) {
        setOpen(false);
        completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
      }
    }
  }
  async function inspect(changed = false) {
    if (!current(generation.current) || pending.current || disabled || reconcile) return;
    const request = ++generation.current;
    reading.current?.abort(); reading.current = new AbortController();
    setOpen(true); setPreview(undefined); setError(undefined); setChecking(true); setConflict(changed); clearCommand();
    try {
      const value = await apiRequest<Preview>(path, { signal: reading.current.signal }, { replayAfterReauthentication: false });
      if (!current(request)) return;
      if (value?.id !== target.id || value.kind !== kind || !Number.isInteger(value.version) || !value.previewToken || !value.counts || !Array.isArray(value.retainedHistory)) throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: '删除影响响应无效' });
      setPreview(value);
    } catch (cause) { if (current(request)) fail(cause); }
    finally { if (current(request)) setChecking(false); }
  }
  async function confirm(recover = false) {
    const request = generation.current;
    if (!current(request) || pending.current || disabled || checking || reconcile) return;
    if (recover ? !unknown || !attempt.current : !preview || !!error || unknown) return;
    const body: Command = attempt.current ?? { expectedVersion: preview!.version, confirmed: true, previewToken: preview!.previewToken };
    attempt.current = body;
    pending.current = true; setBusy(true); setError(undefined);
    writing.current = new AbortController();
    let received = false;
    try {
      // Keep both the body and helper-owned key until an unknown outcome is resolved.
      const value = await mutate.current<Result>(path, 'POST', body, writing.current.signal);
      received = true;
      if (!current(request)) return;
      if (value?.id !== target.id || value.kind !== kind || !value.deletedAt) {
        setReconcile(true);
        throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: '删除结果响应无效' });
      }
      clearCommand(); setPreview(undefined); setOpen(false); onDeleted(value);
    } catch (cause) {
      if (!current(request)) return;
      const refresh = cause instanceof ApiError && cause.status === 409;
      const denied = cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
      const reauthenticated = cause instanceof ApiError && cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED';
      // A failed recovery does not prove that the original command was never committed.
      const uncertain = !received && !denied && !refresh && (recover || !reauthenticated && (!(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408));
      if (refresh) {
        pending.current = false; setBusy(false);
        await inspect(true);
      } else {
        setUnknown(uncertain);
        if (!uncertain) { setPreview(undefined); clearCommand(); }
        fail(cause, uncertain);
      }
    } finally { pending.current = false; if (current(request)) setBusy(false); }
  }
  function close() {
    if (pending.current) return;
    requestLeave(() => { if (!current(generation.current)) return; generation.current++; reading.current?.abort(); setChecking(false); setOpen(false); setPreview(undefined); setError(undefined); clearCommand(); });
  }
  const labels: Record<keyof Preview['counts'], string> = { users: '账号', departments: '部门/科室', positions: '岗位', organizations: '组织（含目标）', assignments: '任职', managementBindings: '管理职责', ministerScopes: '分管范围' };
  if (expired) return null;
  return <>
    <Button danger disabled={disabled || busy || checking || reconcile} onClick={() => requestLeave(() => { if (!current(generation.current)) return; onBeforeOpen?.(); void inspect(); })}>{t('强制删除')}</Button>
    <Modal title={`${t('强制删除')} · ${preview?.name ?? target.name} · ${preview?.code ?? target.code}`} open={open} onCancel={close} onOk={() => void confirm()} okText={t('确认强制删除')} cancelText={t('取消')} confirmLoading={busy} okButtonProps={{ danger: true, disabled: disabled || busy || checking || reconcile || !preview || !!error || unknown }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} footer={(_origin, { OkBtn, CancelBtn }) => <div className="qms-dialog-actions"><CancelBtn /><OkBtn /></div>}>
      <GovernanceFeedback error={error} />
      {reconcile && <Alert type="warning" showIcon title={t('删除响应无法核对，请刷新管理目录核对实际状态，勿重新提交。')} />}
      {conflict && <Alert type="warning" showIcon title={t('影响已变化，已重新读取预览；请核对最新影响后再次确认。')} />}
      {checking && <Spin />}
      {preview && <>
        <Alert type="warning" showIcon title={t('永久删除当前有效对象，不可通过启用恢复。')} description={t('不连带删除下级组织、子部门、岗位或账号；当前关系解除后进入待配置。业务、审批、签署和审计历史保留，原租户归属不改写。')} />
        <Descriptions title={t('受影响的当前关联')} size="small" column={1} items={(Object.keys(labels) as Array<keyof Preview['counts']>).map(key => ({ key, label: t(labels[key]), children: preview.counts[key] }))} />
        <p>{t('保留历史')}</p><ul>{preview.retainedHistory.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
      </>}
      {unknown ? <><Alert type="warning" showIcon title={t('删除结果尚未确认，将使用原请求重试，不会创建新的删除操作。')} /><Button disabled={busy || disabled} loading={busy} onClick={() => void confirm(true)}>{t('重试确认结果')}</Button></> : <Button disabled={busy || checking || disabled || reconcile} onClick={() => void inspect()}>{t('重新读取影响')}</Button>}
    </Modal>
  </>;
}
