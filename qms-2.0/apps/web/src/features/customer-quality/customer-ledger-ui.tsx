import type { components } from '@qms/contracts';
import { Alert, Tooltip } from 'antd';
import { ApiError, safeAccountError } from '../../api/client';
import { ledgerFields, rawText } from './customer-ledger-import';
import { ledgerDenied } from './customer-ledger-write';

export type LedgerItem = components['schemas']['CustomerLedgerItemDto'];
export type LedgerDetail = components['schemas']['CustomerLedgerDetailDto'];
export type LedgerCandidate = components['schemas']['CustomerLedgerCandidateDto'];
export const ledgerBase = '/api/v1/customer-quality/ledger';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const scopedLedger = (path: string, organizationId?: string) => organizationId ? `${path}${path.includes('?') ? '&' : '?'}organizationId=${encodeURIComponent(organizationId)}` : path;
export const candidateLabel = (candidate: LedgerCandidate) => `${candidate.fullName || candidate.username || candidate.userId}${candidate.departmentName ? ` · ${candidate.departmentName}` : ''}${candidate.positionName ? ` · ${candidate.positionName}` : ''}`;
export const typeLabel = (value: string | null) => value === 'ZERO_KM' ? '零公里' : value === 'AFTER_SALES' ? '售后' : '待补正';
export const stageLabel = (value: LedgerItem['stage']) => value === 'NEW_PRODUCT' ? '新品' : value === 'MASS_PRODUCTION' ? '量产' : '阶段待匹配';
export type LedgerConflict = { field: string; before: unknown; latest: unknown; local: unknown };
export function ledgerChanges<T extends object>(before: T, draft: T): Partial<T> {
  return Object.fromEntries((Object.keys(draft) as (keyof T)[]).filter(key => rawText(draft[key]) !== rawText(before[key])).map(key => [key, draft[key]])) as Partial<T>;
}
export function ledgerConflicts<T extends object>(before: T, draft: T, latest: T): LedgerConflict[] {
  return (Object.keys(ledgerChanges(before, draft)) as (keyof T)[])
    .filter(key => rawText(before[key]) !== rawText(latest[key]) && rawText(draft[key]) !== rawText(latest[key]))
    .map(key => ({ field: String(key), before: before[key], latest: latest[key], local: draft[key] }));
}
export function LedgerConflicts({ conflicts, confirmed, onConfirm, disabled }: { conflicts: LedgerConflict[]; confirmed: boolean; onConfirm: (value: boolean) => void; disabled: boolean }) {
  if (!conflicts.length) return null;
  const labels: Record<string, string> = { investigation: '调查情况', courierNumber: '快递单号', receivedOn: '收件日期', customerId: '关联客户', qualityEngineerAssignmentId: '实际跟进质量工程师' };
  return <section aria-label="字段冲突核对"><Alert type="warning" title="同一字段已被修改，请核对原值、服务器新值及本地草稿后明确确认。" /><dl className="customer-ledger-facts">{conflicts.map(conflict => <div key={conflict.field}><dt>{ledgerFields.find(([key]) => key === conflict.field)?.[1] ?? labels[conflict.field] ?? conflict.field}</dt><dd className="customer-ledger-raw"><div>原：{rawText(conflict.before) || '（空）'}</div><div>服务器：{rawText(conflict.latest) || '（空）'}</div><div>本地：{rawText(conflict.local) || '（空）'}</div></dd></div>)}</dl><label><input type="checkbox" aria-label="确认保留本地冲突值" checked={confirmed} disabled={disabled} onChange={event => onConfirm(event.target.checked)} />确认保留本地冲突值</label></section>;
}
const warningLabels: Record<string, string> = {
  INVALID_VALUE: '格式无效，规范值为空（不参与计算）', BEFORE_PRODUCTION: '发生日期早于生产日期，不计算服务月数 / MIS',
  QUANTITY_NOT_RECORDED: '件数未记录', CUSTOMER_NOT_RECORDED: '客户未记录', CUSTOMER_UNRESOLVED: '客户待匹配',
  ENGINEER_NOT_CONFIGURED: '未配置可用跟进工程师', ENGINEER_NO_LONGER_ELIGIBLE: '原工程师任职已失效，请核对交接',
  MANUAL_ENGINEER_DIFFERS: '人工工程师与映射建议不同', ENGINEER_HANDOVER_REQUIRED: '映射人员已变化，待人工交接',
  AGGREGATE_DERIVATION_NOT_APPLICABLE: '汇总或未知件数，不计算单车派生值',
  MAPPING_NOT_FOUND: '未检索到映射关系',
  PROJECT_STAGE_CHANGED: '项目阶段已变化，请核对跟进人',
};
export function LedgerError({ cause }: { cause: unknown }) {
  return cause ? <Alert showIcon type={ledgerDenied(cause) ? 'warning' : 'error'} title={cause instanceof ApiError ? safeAccountError(cause) : cause instanceof Error ? cause.message : '操作失败，请重试。'} description={cause instanceof ApiError ? cause.traceId : undefined} /> : null;
}
export function LedgerWarnings({ warnings, raw, label }: { warnings: LedgerItem['warnings']; raw: LedgerItem['raw']; label: string }) {
  if (!warnings.length) return null;
  return <Tooltip trigger={['hover', 'focus']} title={<ul className="customer-ledger-warning-list">{warnings.map((warning, index) => {
    const field = ledgerFields.find(([key]) => key === warning.field);
    return <li key={`${warning.field}-${warning.code}-${index}`}>{field?.[1] ?? warning.field}：{warningLabels[warning.code] ?? warning.code}{field ? <div className="customer-ledger-raw">原填写：{rawText(raw[field[0]]) || '（空）'}</div> : null}</li>;
  })}</ul>}><button type="button" className="customer-ledger-warning" aria-label={`${label} 待补正说明`}>!</button></Tooltip>;
}
