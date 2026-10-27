import type { components } from '@qms/contracts';
import { Alert, Button, Spin } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession, safeAccountError } from '../../api/client';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { EightDEvidence } from '../process-eight-d/EightDEvidence';
import { EightDEvidenceScopeContext } from '../process-eight-d/EightDEvidenceScope';
import type { EightDRead } from '../process-eight-d/eight-d';
import { ledgerBase, scopedLedger } from './customer-ledger-ui';

interface Props {
  recordId: string;
  organizationId?: string;
  readOnly: boolean;
  onDenied: (cause: unknown) => void;
  onPendingChange?: (pending: boolean) => void;
}

export function CustomerLedgerSourceAttachments(props: Props) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <SourceAttachments key={`${scope}:${props.organizationId}:${props.recordId}`} {...props} scope={scope} />;
}

function SourceAttachments({ recordId, organizationId, readOnly, onDenied, onPendingChange, scope }: Props & { scope?: string }) {
  const [fileIds, setFileIds] = useState<string[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  useUnsavedChanges(pending);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const pendingChanged = useCallback((value: boolean) => { setPending(value); pendingCallback.current?.(value); }, []);
  const scopedPendingChanged = useCallback((_id: string, value: boolean) => pendingChanged(value), [pendingChanged]);
  useEffect(() => () => pendingCallback.current?.(false), []);
  const deniedCallback = useRef(onDenied);
  deniedCallback.current = onDenied;
  const accessLost = useRef(false);
  const lifetime = useRef<AbortController>(undefined);
  function current() { return !lifetime.current?.signal.aborted && useWorkTabsStore.getState().sessionScope === scope; }
  const filesChanged = useCallback((ids: string[]) => {
    if (lifetime.current?.signal.aborted || useWorkTabsStore.getState().sessionScope !== scope) return;
    setFileIds(ids); setRevision(value => value + 1);
  }, [scope]);
  const accessDenied = useCallback((cause: unknown) => {
    if (lifetime.current?.signal.aborted || useWorkTabsStore.getState().sessionScope !== scope) return;
    accessLost.current = true;
    setDenied(true); deniedCallback.current(cause);
  }, [scope]);
  const fileReady = useCallback((file: components['schemas']['FileDto']) => {
    if (accessLost.current || lifetime.current?.signal.aborted || useWorkTabsStore.getState().sessionScope !== scope || file.resourceType !== 'CustomerComplaint' || file.resourceId !== recordId || file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN') return false;
    setFileIds(ids => ids?.includes(file.id) ? ids : [...(ids ?? []), file.id]);
    setRevision(value => value + 1);
    return true;
  }, [recordId, scope]);
  const read: EightDRead = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const signal = AbortSignal.any([lifetime.current!.signal, ...(init.signal ? [init.signal] : [])]);
    const guard = () => {
      signal.throwIfAborted();
      if (useWorkTabsStore.getState().sessionScope !== scope) throw new DOMException('Source scope changed', 'AbortError');
    };
    guard();
    const session = await getSession();
    guard();
    const principal = `${session.accountType}:${session.organizationId}:${session.userId}`;
    if (session.accountType !== 'INTERNAL' || scope && scope !== principal) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
    const headers = Object.fromEntries(new Headers(init.headers));
    if (init.method && !['GET', 'HEAD'].includes(init.method)) {
      headers['x-csrf-token'] = await csrfToken(signal);
      guard();
      const latest = await getSession();
      guard();
      if (`${latest.accountType}:${latest.organizationId}:${latest.userId}` !== principal) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
    }
    const result = await apiRequest<T>(path, { ...init, headers, signal }, { replayAfterReauthentication: false });
    guard();
    return result;
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setLoading(true); setError(undefined);
    async function load() {
      try {
        const session = await getSession();
        if (!current()) return;
        const principal = `${session.accountType}:${session.organizationId}:${session.userId}`;
        if (session.accountType !== 'INTERNAL' || scope && scope !== principal) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
        const result = await apiRequest<components['schemas']['FileDto'][]>(scopedLedger(`${ledgerBase}/${recordId}/attachments`, organizationId), { signal: controller.signal }, { replayAfterReauthentication: false });
        if (!current() || controller.signal.aborted) return;
        const latest = await getSession();
        if (!current() || controller.signal.aborted) return;
        if (`${latest.accountType}:${latest.organizationId}:${latest.userId}` !== principal) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
        if (!Array.isArray(result)) throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: '' });
        setFileIds(result.map(file => file.id));
      } catch (cause) {
        if (!current() || controller.signal.aborted) return;
        setError(cause);
        if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) accessDenied(cause);
      } finally { if (current() && !controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [recordId, organizationId, scope, revision]);
  if (denied) return null;
  return <section aria-label="客诉来源附件">
    <p>批次或客户清单可作为来源附件；附件不自动拆行或计算件数，登记件数仍由录入人填写。</p>
    {pending ? <Alert type="info" title="本次附件正在上传或等待安全扫描；完成前不能保存台账编辑、关闭或恢复跟进。" /> : null}
    {loading ? <Spin aria-label="正在读取来源附件" /> : null}
    {error ? <Alert type="error" showIcon title={safeAccountError(error)} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    <Button aria-label={error ? '重试读取来源附件' : '刷新来源附件'} disabled={loading} onClick={() => setRevision(value => value + 1)}>{error ? '重试读取来源附件' : '刷新来源附件'}</Button>
    {fileIds ? <EightDEvidenceScopeContext.Provider value={{ onAccessDenied: accessDenied, onPendingChange: scopedPendingChanged }}><EightDEvidence problemId={recordId} resource={{ resourceType: 'CustomerComplaint', resourceId: recordId }} fileIds={fileIds} readOnly={readOnly} read={read} onChange={filesChanged} onFileReady={fileReady} onLocalPendingChange={pendingChanged} /></EightDEvidenceScopeContext.Provider> : null}
  </section>;
}
