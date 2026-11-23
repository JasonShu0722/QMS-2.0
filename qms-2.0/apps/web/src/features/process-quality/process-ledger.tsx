import type { components } from '@qms/contracts';
import { Alert, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, getSession, safeAccountError } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useLanguage } from '../../i18n/Language';
import { factoryIssue } from './process-factory';

export type Defect = components['schemas']['ProcessDefectDto'];
export const categoryLabels: Record<NonNullable<Defect['responsibilityCategory']>, string> = {
  MATERIAL: '物料', OPERATION: '作业', EQUIPMENT: '设备', PROCESS: '工艺', DESIGN: '设计', FALSE_POSITIVE: '误报',
};
export const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));
export const verificationLabels = { UNREVIEWED: '未复核', CONFIRMED_DEFECT: '不良属实', NOT_MATERIAL: '非物料', NEGOTIATED: '协商', RETURN_ANALYSIS: '返厂解析' };
export function denied(cause: unknown) { return cause instanceof ApiError && [401, 403].includes(cause.status ?? 0); }
export function ProcessError({ cause, fallback }: { cause: unknown; fallback: string }) {
  return cause ? <Alert showIcon type={denied(cause) ? 'warning' : 'error'} title={cause instanceof ApiError && cause.code === 'PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT' ? '来源明细编号已用于另一条台账，请核对；当前记录及输入均保留。' : cause instanceof ApiError ? safeAccountError(cause) : fallback} /> : null;
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
  SAME_OPERATION_TRACE_DUPLICATE: '同工序同条码已有记录。',
  MANUAL_PROJECT_DIFFERS: '人工项目与映射建议不同。',
  DESCRIPTION_EMPTY: '不良描述待完善。',
  DEFECT_QUANTITY_UNKNOWN: '不良数量未知。',
  OCCURRED_AT_UNKNOWN: '发生时间未知。',
  PRODUCT_CATEGORY_NOT_CONFIGURED: '映射尚未配置产品分类。',
  MAPPING_OR_PROJECT_DISABLED: '映射或项目已停用，请核对。',
  MANUAL_ENGINEER_DIFFERS: '人工工程师与映射建议不同。',
  OCCURRED_AT_REQUIRED: '发生时间待完善。', PRODUCT_CODE_REQUIRED: '成品编码待完善。', TRACE_CODE_REQUIRED: '追溯码待完善。', DESCRIPTION_REQUIRED: '不良描述待完善。',
  HISTORICAL_ASSOCIATION_UNCONFIRMED: '历史关联未确认。',
};
const detailOnlyHints: Record<string, string> = {
  PROJECT_MAPPING_PENDING: '项目映射待补配。', COMPONENT_PROJECT_UNMAPPED: '项目映射待补配。',
  MAPPING_NOT_FOUND: '项目映射待补配。', PROJECT_NOT_CONFIGURED: '项目映射待补配。',
  OPERATION_SECTOR_PENDING: '工序板块待补配。',
};
const hiddenHints = new Set(['PRODUCT_SUBCATEGORY_PENDING', 'SOURCE_IDENTITY_INCOMPLETE', 'DEFECT_TYPE_UNKNOWN']);
const hintFields: Record<string, string> = {
  OCCURRED_AT_REQUIRED: 'occurredAt', OCCURRED_AT_UNKNOWN: 'occurredAt', PRODUCT_CODE_REQUIRED: 'productCode',
  TRACE_CODE_REQUIRED: 'traceCode', DESCRIPTION_REQUIRED: 'description', DESCRIPTION_EMPTY: 'description',
};
const sourceFieldLabels: Record<string, string> = {
  occurredAt: '发生时间', productCode: '成品编码', workOrderCode: '工单号', lineCode: '生产线编码', lineName: '生产线名称',
  operationCode: '工序编码', operationName: '工序名称', traceCode: '追溯码', description: '不良描述', externalRecordKey: '来源明细编号', sourceObservedAt: '来源更新时间',
};
function visibleHintMessages(record: Defect, detail: boolean, english: boolean) {
  const hints = [...new Set([...(record.registrationIssues ?? []), ...(record.issues ?? []), ...(record.componentProject?.issues ?? [])])];
  if (record.duplicateCount) hints.push('SAME_OPERATION_TRACE_DUPLICATE');
  const byField = new Map<string, string>();
  let unknown = false;
  for (const hint of hints) {
    const [field, problem] = hint.split(':');
    const factoryMessage = factoryIssue(hint, english);
    if (factoryMessage) byField.set(field, factoryMessage);
    if (!Object.hasOwn(sourceFieldLabels, field) || byField.has(field)) continue;
    if (problem === 'TYPE') byField.set(field, `${sourceFieldLabels[field]}来源值类型无效，请核对。`);
    if (problem === 'INVALID') byField.set(field, `${sourceFieldLabels[field]}来源值格式或长度无效，请核对。`);
  }
  for (const hint of hints) {
    if (hiddenHints.has(hint)) continue;
    if (Object.hasOwn(detailOnlyHints, hint)) {
      if (detail) byField.set(detailOnlyHints[hint], detailOnlyHints[hint]);
    } else if (Object.hasOwn(hintLabels, hint)) {
      const field = Object.hasOwn(hintFields, hint) ? hintFields[hint] : hint;
      if (!byField.has(field)) byField.set(field, hintLabels[hint]);
    } else if (!byField.has(hint.split(':')[0])) {
      unknown = true;
    }
  }
  return byField.size ? [...byField.values()] : unknown ? ['来源字段待核对'] : [];
}
export function CompletionStatus({ record, detail = false }: { record: Defect; detail?: boolean }) {
  const messages = visibleHintMessages(record, detail, useLanguage().locale === 'en-US');
  return messages.length ? <div className="process-quality-completion">{messages.join(' ')}</div> : '—';
}
export function MappingHint({ record }: { record: Defect }) {
  const messages = visibleHintMessages(record, false, useLanguage().locale === 'en-US');
  if (!messages.length) return null;
  return <Tooltip trigger={['hover', 'focus']} title={<ul>{messages.map(hint => <li key={hint}>{hint}</li>)}</ul>}>
    <button type="button" className="process-quality-warning" aria-label={`映射与来源提示 ${record.description}`}>!</button>
  </Tooltip>;
}
