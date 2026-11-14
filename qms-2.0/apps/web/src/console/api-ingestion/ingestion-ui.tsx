import { useEffect, useRef, useState } from 'react';
import { Alert, Descriptions, Table } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';
import { isAborted, useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';

export type Rule = components['schemas']['IngestionRuleDto'];
export type Endpoint = components['schemas']['IngestionEndpointDto'];
export type Job = components['schemas']['IngestionJobDto'];
export type Item = components['schemas']['IngestionItemDto'];
export const ingestionPath = '/api/v1/admin/integrations/ingestion';
export function useIngestionText() {
  const { locale } = useLanguage();
  return (zh: string, en: string) => locale === 'en-US' ? en : zh;
}
export function label(value: string, english: boolean) {
  const labels: Record<string, [string, string]> = {
    SUPPLIER: ['供应商档案', 'Supplier profiles'], CUSTOMER: ['客户档案', 'Customer profiles'], MATERIAL: ['物料主数据', 'Material master'], COMPONENT: ['组件项目映射', 'Component mapping'],
    INSERT_ONLY: ['仅新增，已有跳过', 'Insert only'], UPDATE: ['新增并更新指定字段', 'Insert and update selected fields'], CONFIRM: ['新增，变更人工确认', 'Insert and confirm changes'],
    PENDING: ['待处理', 'Pending'], PAUSED: ['已暂停', 'Paused'], BLOCKED: ['已阻塞', 'Blocked'], COMPLETED: ['已完成', 'Completed'], CANCELLED: ['已取消', 'Cancelled'],
    INSERTED: ['已新增', 'Inserted'], UPDATED: ['已更新', 'Updated'], UNCHANGED: ['无变化', 'Unchanged'], FILTERED: ['筛选跳过', 'Filtered'], EXISTING_SKIPPED: ['已有跳过', 'Existing skipped'],
    AWAITING_CONFIRMATION: ['待确认', 'Awaiting confirmation'], VALIDATION_FAILED: ['校验失败', 'Validation failed'], PROCESSING_FAILED: ['处理失败', 'Processing failed'], SKIPPED: ['已跳过', 'Skipped'],
    AUTO: ['自动触发', 'Automatic'], SINGLE: ['单条导入', 'Single import'], HISTORY: ['历史导入', 'Historical import'],
    code: ['编码', 'Code'], name: ['名称', 'Name'], contactName: ['联系人', 'Contact'], contactEmail: ['联系邮箱', 'Contact email'],
    PAUSE: ['暂停', 'Pause'], RESUME: ['恢复', 'Resume'], CANCEL: ['取消任务', 'Cancel job'], RETRY: ['重试处理', 'Retry processing'],
  };
  return labels[value]?.[english ? 1 : 0] ?? value;
}
export function ingestionIssue(code: string, english: boolean) {
  const messages: Record<string, [string, string]> = {
    INGESTION_FIELD_MISSING: ['缺少必需来源字段', 'A required source field is missing'], INGESTION_FIELD_TYPE: ['来源字段类型与规则不符', 'A source field has an unexpected type'],
    INGESTION_FIELD_INVALID: ['来源字段内容、长度或格式无效', 'A source field has an invalid value, length or format'], INGESTION_SOURCE_VERSION_INVALID: ['来源更新时间无效', 'The source update time is invalid'],
    INGESTION_AUTHORIZATION_REVOKED: ['入库授权已失效', 'Ingestion authorization was revoked'], INGESTION_PROCESSING_FAILED: ['处理失败，请重试或核查任务', 'Processing failed. Retry or investigate the job'],
    INGESTION_QUEUE_BLOCKED: ['接口队列已阻塞', 'The interface queue is blocked'], INGESTION_STALE_CONFIRMATION: ['档案或来源已变化，请刷新差异', 'The record or source changed. Refresh differences'],
    INTEGRATION_PAYLOAD_EXPIRED: ['接收正文已清理', 'The received payload expired'], INTEGRATION_MESSAGE_INVALID: ['接收正文格式无效', 'The received payload is invalid'],
    INTEGRATION_ACCESS_DENIED: ['接收接口已停用或不可访问', 'The receiving interface is disabled or unavailable'], CONCURRENCY_CONFLICT: ['档案已变化，请刷新后核对', 'The record changed. Refresh and review'],
    INTEGRATION_INPUT_INVALID: ['目标档案字段无效', 'Target record fields are invalid'], INTEGRATION_RECEIPT_NOT_FOUND: ['接收记录不存在或不可访问', 'The receiving record is unavailable'],
  };
  return (messages[code] ?? ['处理异常，请联系管理员核查', 'Processing failed. Contact an administrator'])[english ? 1 : 0];
}
export function IngestionError({ error, unknown = false, unknownTitle }: { error?: unknown; unknown?: boolean; unknownTitle?: string }) {
  const text = useIngestionText();
  if (!error) return null;
  const messages: Record<string, [string, string]> = {
    INGESTION_RULE_OVERLAP: ['该接口和目标已有启用规则，请先停用原规则', 'An enabled rule already exists for this interface and target. Disable it first.'],
    INGESTION_RULE_INVALID: ['请检查必填字段、筛选条件及允许更新字段', 'Check required mappings, conditions and update fields.'],
    INGESTION_PREVIEW_EXPIRED: ['预览已过期，请重新生成预览', 'Preview expired. Generate a new preview.'],
    INGESTION_STALE_CONFIRMATION: ['档案已变化，请刷新差异后重新确认', 'The record changed. Refresh differences before confirming.'],
    INGESTION_AUTHORIZATION_REVOKED: ['操作权限已变化，请重新验证', 'Authorization changed. Revalidate access.'],
    INTEGRATION_PAYLOAD_EXPIRED: ['接收正文已清理，请选择其他接收记录', 'The received payload expired. Select another record.'],
    INGESTION_CAPACITY_UNAVAILABLE: ['处理容量不足，请先处理积压任务', 'Processing capacity is unavailable. Resolve queued jobs first.'],
    INGESTION_QUEUE_BLOCKED: ['接口队列已阻塞，请查看任务错误并处理', 'The interface queue is blocked. Resolve the job error.'],
    INGESTION_HISTORY_LIMIT_EXCEEDED: ['请重新生成历史预览', 'Generate a new historical preview.'],
    INGESTION_PREVIEW_LIMIT_EXCEEDED: ['临时预览已达上限，请稍后重试', 'Temporary preview capacity is full. Retry later.'],
  };
  const message = error instanceof ApiError ? messages[error.code] : undefined;
  return <Alert role="alert" type="error" showIcon title={unknown
    ? unknownTitle ?? text('操作结果未确认，请重试原请求；当前输入已锁定', 'The outcome is unknown. Retry the original request; inputs are locked.')
    : message ? text(...message) : error instanceof ApiError && error.status === 409
      ? text('配置或档案已变化，请保留输入并刷新后重试', 'Configuration or records changed. Preserve your input and refresh before retrying.')
      : text('请求失败，请检查输入后重试', 'Request failed. Check your input and retry.')}
    description={error instanceof ApiError ? error.traceId : undefined} />;
}

type Requests = ReturnType<typeof useScopedIntegrationRequests>;
type Command = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body: Parameters<Requests['write']>[2] };
export function useIngestionMutation(scope: IntegrationScope, options?: { recoverableUnknown?: boolean }) {
  const recoverableUnknown = options?.recoverableUnknown ?? false;
  const requests = useScopedIntegrationRequests(scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [unknown, setUnknown] = useState(false);
  const pending = useRef(false);
  const frozen = useRef<{ command: Command; done: (result: unknown) => void } | undefined>(undefined);
  useNavigationBusy(busy || unknown);
  async function execute<Result>(command: Command, done: (result: Result) => void) {
    if (pending.current || !requests.current() || frozen.current && !unknown) return;
    const attempt = frozen.current ?? { command, done: done as (result: unknown) => void };
    frozen.current = attempt; pending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await requests.write<Result>(attempt.command.path, attempt.command.method, attempt.command.body);
      if (!requests.current()) return;
      frozen.current = undefined; setUnknown(false); attempt.done(result);
    } catch (cause) {
      if (!requests.current() || isAborted(cause)) return;
      const known = cause instanceof ApiError && (cause.status !== undefined && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 425 || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED');
      if (known || recoverableUnknown) frozen.current = undefined;
      setUnknown(!known && !recoverableUnknown); setError(cause);
    } finally { if (requests.current()) { pending.current = false; setBusy(false); } }
  }
  function retry() { if (frozen.current) void execute(frozen.current.command, frozen.current.done); }
  return { execute, retry, busy, unknown, error, locked: busy || unknown };
}

export function useIngestionPage<Data extends { items: unknown[]; total: number; page: number; limit: number }>(scope: IntegrationScope, path: string, page: number, limit: number, revision: number, extra?: Record<string, string>) {
  const { read, current } = useScopedIntegrationRequests(scope);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const queryKey = JSON.stringify(extra ?? {});
  useEffect(() => {
    let active = true; setLoading(true); setError(undefined); setData(undefined);
    void read<Data>(path, { ...JSON.parse(queryKey), page: String(page), limit: String(limit) }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(item => item && typeof item === 'object' && 'organizationId' in item && item.organizationId !== scope.organizationId) || result.page !== page || result.limit !== limit || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setData(result);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [read, current, scope.deny, path, page, limit, revision, queryKey]);
  return { data, error, loading };
}

export function IngestionFields({ fields, differences }: { fields?: Record<string, string>; differences?: components['schemas']['IngestionDifferenceDto'][] }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  return <div className="qms-ingestion-section">
    {fields && <Descriptions size="small" bordered column={1} items={Object.entries(fields).map(([field, value]) => ({ key: field, label: label(field, english), children: value }))} />}
    {!!differences?.length && <Table size="small" rowKey="field" pagination={false} dataSource={differences} scroll={{ x: 480 }} columns={[
      { key: 'field', title: text('字段', 'Field'), dataIndex: 'field', render: value => label(value, english) },
      { key: 'before', title: text('原值', 'Before'), dataIndex: 'before', render: value => value ?? '—' },
      { key: 'after', title: text('新值', 'After'), dataIndex: 'after', render: value => value ?? '—' },
    ]} />}
  </div>;
}
