import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Body = components['schemas']['CustomerLedgerCreateDto'] | components['schemas']['CustomerLedgerUpdateDto'] |
  components['schemas']['CustomerLedgerImportDto'] | components['schemas']['CustomerLedgerReceivingDto'] | components['schemas']['CustomerLedgerNoteDto'] | components['schemas']['CustomerLedgerReassignDto'] |
  components['schemas']['IssueCustomerEightDDto'] | components['schemas']['IssueNewProductEightDDto'] | components['schemas']['SelectNewProductDefectDto'];
export const ledgerDenied = (cause: unknown) => cause instanceof ApiError && [401, 403].includes(cause.status ?? 0);

export function useCustomerLedgerWrite(onDenied: (cause: unknown) => void) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const controller = useRef<AbortController>(undefined);
  const pending = useRef<{ path: string; body: string; method: 'POST' | 'PUT'; key: string }>(undefined);
  const active = useRef(false);
  const unknown = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { controller.current = new AbortController(); return () => { controller.current?.abort(); pending.current = undefined; }; }, []);
  function discard() {
    if (active.current) return;
    pending.current = undefined; unknown.current = false; setUncertain(false);
  }
  async function write<T>(path: string, body: Body, method: 'POST' | 'PUT', canDispatch?: () => boolean): Promise<T> {
    const signal = controller.current!.signal;
    signal.throwIfAborted();
    if (active.current) throw new Error('请求正在处理中，请勿重复提交。');
    if (canDispatch?.() === false) throw new Error('来源附件正在处理中，请等待后再保存。');
    active.current = true; setBusy(true);
    const encoded = JSON.stringify(body);
    if (!pending.current || (!unknown.current && (pending.current.path !== path || pending.current.body !== encoded || pending.current.method !== method))) pending.current = { path, body: encoded, method, key: crypto.randomUUID() };
    const attempt = pending.current;
    let dispatched = false;
    try {
      const session = await getSession();
      const principal = `${session.accountType}:${session.organizationId}:${session.userId}`;
      const guard = () => {
        signal.throwIfAborted();
        if (session.accountType !== 'INTERNAL' || useWorkTabsStore.getState().sessionScope !== scope || (scope && scope !== principal)) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      };
      guard();
      const token = await csrfToken(signal);
      guard();
      const current = await getSession();
      guard();
      if (`${current.accountType}:${current.organizationId}:${current.userId}` !== principal) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      if (canDispatch?.() === false) throw new Error('来源附件正在处理中，请等待后再保存。');
      dispatched = true;
      const result = await apiRequest<T>(attempt.path, { method: attempt.method, signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: attempt.body }, { replayAfterReauthentication: false });
      guard(); pending.current = undefined; unknown.current = false; setUncertain(false);
      return result;
    } catch (cause) {
      if (!signal.aborted) {
        if (ledgerDenied(cause)) { pending.current = undefined; unknown.current = false; onDenied(cause); }
        else if (cause instanceof ApiError && cause.status === 409) unknown.current = false;
        else if (dispatched) unknown.current ||= !(cause instanceof ApiError && cause.code !== 'CLIENT_REAUTHENTICATION_COMPLETED' && cause.status !== undefined && cause.status < 500 && ![408, 425].includes(cause.status));
        setUncertain(unknown.current);
      }
      throw cause;
    } finally { active.current = false; if (!signal.aborted) setBusy(false); }
  }
  return { write, discard, busy, uncertain, signal: () => controller.current!.signal };
}
