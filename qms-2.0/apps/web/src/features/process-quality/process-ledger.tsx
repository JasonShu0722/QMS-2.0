import type { components } from '@qms/contracts';
import { Alert, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession, safeAccountError } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

export type Defect = components['schemas']['ProcessDefectDto'];
export const categoryLabels: Record<NonNullable<Defect['responsibilityCategory']>, string> = {
  MATERIAL: '物料', OPERATION: '作业', EQUIPMENT: '设备', PROCESS: '工艺', DESIGN: '设计', FALSE_POSITIVE: '误报',
};
export const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));
export const verificationLabels = { UNREVIEWED: '未复核', CONFIRMED_DEFECT: '不良属实', NOT_MATERIAL: '非物料', NEGOTIATED: '协商', RETURN_ANALYSIS: '返厂解析' };
export function denied(cause: unknown) { return cause instanceof ApiError && [401, 403].includes(cause.status ?? 0); }
export function ProcessError({ cause, fallback }: { cause: unknown; fallback: string }) {
  return cause ? <Alert showIcon type={denied(cause) ? 'warning' : 'error'} title={cause instanceof ApiError ? safeAccountError(cause) : fallback} /> : null;
}

// An unknown write result must retain the exact request, not merely its key.
export function useProcessWrite(onDenied: (cause?: unknown) => void) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const controller = useRef<AbortController>(undefined);
  const pending = useRef<{ path: string; method: string; body: string; key: string }>(undefined);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current?.abort();
  }, []);
  async function write<T>(path: string, body: unknown, method = 'PUT'): Promise<T> {
    const signal = controller.current!.signal;
    signal.throwIfAborted();
    if (inFlight.current) throw new Error('请求正在处理中，请勿重复操作。');
    inFlight.current = true;
    const encoded = JSON.stringify(body);
    if (!pending.current || (!uncertain && (pending.current.path !== path || pending.current.body !== encoded || pending.current.method !== method))) {
      pending.current = { path, method, body: encoded, key: crypto.randomUUID() };
    }
    const attempt = pending.current;
    setBusy(true);
    try {
      const session = await getSession();
      signal.throwIfAborted();
      if (scope && scope !== `${session.accountType}:${session.organizationId}:${session.userId}`) {
        throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      }
      const token = await csrfToken(signal);
      signal.throwIfAborted();
      const result = await apiRequest<T>(attempt.path, { method: attempt.method, signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: attempt.body }, { replayAfterReauthentication: false });
      signal.throwIfAborted();
      pending.current = undefined; setUncertain(false);
      return result;
    } catch (cause) {
      if (!signal.aborted) {
        if (denied(cause)) {
          pending.current = undefined; setUncertain(false);
          onDenied(cause);
        } else if (cause instanceof ApiError && cause.status === 409) setUncertain(false);
        else setUncertain(uncertain || !(cause instanceof ApiError && cause.code !== 'CLIENT_REAUTHENTICATION_COMPLETED' && cause.status !== undefined && cause.status < 500 && cause.status !== 408 && cause.status !== 425));
      }
      throw cause;
    } finally { inFlight.current = false; if (!signal.aborted) setBusy(false); }
  }
  return { write, busy, uncertain, signal: () => controller.current!.signal };
}

const hintLabels: Record<string, string> = {
  SAME_OPERATION_TRACE_DUPLICATE: '同工序同条码已有记录，仅提示，不阻止登记。',
  MANUAL_PROJECT_DIFFERS: '人工项目与映射建议不同，保留人工项目，不自动覆盖。',
  COMPONENT_PROJECT_UNMAPPED: '零部件尚未映射项目，请核对人工资料。',
  DESCRIPTION_EMPTY: '失效现象尚未填写，可后续补充。',
  DEFECT_TYPE_UNKNOWN: '失效类型未知，可后续补充。',
  DEFECT_QUANTITY_UNKNOWN: '不良数量未知，不使用默认数量。',
  OCCURRED_AT_UNKNOWN: '发生时间未知，不使用登记时间冒充。',
  MAPPING_NOT_FOUND: '零部件尚未建立项目映射。',
  PROJECT_NOT_CONFIGURED: '映射尚未配置项目，保留人工资料。',
  PRODUCT_CATEGORY_NOT_CONFIGURED: '映射尚未配置产品分类。',
  MAPPING_OR_PROJECT_DISABLED: '映射或项目已停用，请核对。',
  MANUAL_ENGINEER_DIFFERS: '人工工程师与建议不同，不自动覆盖。',
};
export function MappingHint({ record }: { record: Defect }) {
  const hints = [...(record.issues ?? []), ...(record.componentProject?.issues ?? [])];
  if (record.duplicateCount && !hints.includes('SAME_OPERATION_TRACE_DUPLICATE')) hints.push('SAME_OPERATION_TRACE_DUPLICATE');
  if (!hints.length) return null;
  return <Tooltip trigger={['hover', 'focus']} title={<ul>{[...new Set(hints)].map(hint => <li key={hint}>{hintLabels[hint] ?? hint}</li>)}</ul>}>
    <button type="button" className="process-quality-warning" aria-label={`映射与来源提示 ${record.description}`}>!</button>
  </Tooltip>;
}
