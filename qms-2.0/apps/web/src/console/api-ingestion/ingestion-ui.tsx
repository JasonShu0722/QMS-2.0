import { useEffect, useRef, useState } from 'react';
import { Alert, Descriptions, Table, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';
import { isAborted, useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';
import { Link } from 'react-router-dom';
import { factoryFieldLabel, factoryIssue, factoryLabel } from '../../features/process-quality/process-factory';

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
  if (value === 'factoryCode') return factoryFieldLabel[english ? 1 : 0];
  const labels: Record<string, [string, string]> = {
    SUPPLIER: ['供应商档案', 'Supplier profiles'], CUSTOMER: ['客户档案', 'Customer profiles'], MATERIAL: ['物料主数据', 'Material master'], COMPONENT: ['组件项目映射', 'Component mapping'], OPERATION: ['工序主数据', 'Operation master'], PROCESS_DEFECT: ['制程不良品台账', 'Process defect ledger'],
    INSERT_ONLY: ['仅新增，已有跳过', 'Insert only'], UPDATE: ['新增并更新指定字段', 'Insert and update selected fields'], CONFIRM: ['新增，变更人工确认', 'Insert and confirm changes'],
    PENDING: ['待处理', 'Pending'], PAUSED: ['已暂停', 'Paused'], BLOCKED: ['已阻塞', 'Blocked'], COMPLETED: ['已完成', 'Completed'], CANCELLED: ['已取消', 'Cancelled'],
    INSERTED: ['已新增', 'Inserted'], UPDATED: ['已更新', 'Updated'], UNCHANGED: ['无变化', 'Unchanged'], FILTERED: ['筛选跳过', 'Filtered'], EXISTING_SKIPPED: ['已有跳过', 'Existing skipped'],
    AWAITING_CONFIRMATION: ['待确认', 'Awaiting confirmation'], VALIDATION_FAILED: ['校验失败', 'Validation failed'], PROCESSING_FAILED: ['处理失败', 'Processing failed'], SKIPPED: ['已跳过', 'Skipped'],
    AUTO: ['自动触发', 'Automatic'], SINGLE: ['单条导入', 'Single import'], HISTORY: ['历史导入', 'Historical import'],
    code: ['编码', 'Code'], name: ['名称', 'Name'], contactName: ['联系人', 'Contact'], contactEmail: ['联系邮箱', 'Contact email'],
    registrationIssues: ['来源字段问题', 'Source field issues'], aiDescription: ['AI整理输入与配置', 'AI description input and configuration'],
    occurredAt: ['发生时间', 'Occurrence time'], productCode: ['成品编码', 'Product code'], workOrderCode: ['工单号', 'Work order'], lineCode: ['生产线编码', 'Line code'], lineName: ['生产线名称', 'Line name'], operationCode: ['工序编码', 'Operation code'], operationName: ['工序名称', 'Operation name'], traceCode: ['追溯码', 'Trace code'], description: ['不良描述', 'Defect description'], externalRecordKey: ['来源明细编号', 'Source detail ID'], sourceObservedAt: ['来源更新时间', 'Source updated time'],
    PAUSE: ['暂停', 'Pause'], RESUME: ['恢复', 'Resume'], CANCEL: ['取消任务', 'Cancel job'], RETRY: ['重试处理', 'Retry processing'],
  };
  return labels[value]?.[english ? 1 : 0] ?? value;
}
const issueMessages: Record<string, [string, string]> = {
  INGESTION_RULE_OVERLAP: ['该接口和目标已有启用规则，请先停用原规则', 'An enabled rule already exists for this interface and target. Disable it first.'],
  INGESTION_RULE_INVALID: ['入库规则或操作参数无效，请核对当前输入和规则设置', 'The ingestion rule or operation parameters are invalid. Check your input and the rule settings.'],
  INGESTION_FIELD_MISSING: ['缺少必需来源字段', 'A required source field is missing'],
  INGESTION_FIELD_TYPE: ['来源字段类型与规则不符', 'A source field has an unexpected type'],
  INGESTION_FIELD_INVALID: ['来源字段内容、长度或格式无效', 'A source field has an invalid value, length or format'],
  INGESTION_SOURCE_VERSION_INVALID: ['来源更新时间格式无效，请使用含时区的 ISO 8601 时间', 'The source update time is invalid. Use an ISO 8601 timestamp with a time zone.'],
  INGESTION_NOT_FOUND: ['入库记录不存在或不可访问', 'The ingestion record does not exist or is unavailable'],
  INGESTION_PREVIEW_EXPIRED: ['预览已过期或配置已变化，请重新生成预览', 'The preview expired or its configuration changed. Generate a new preview.'],
  INGESTION_INPUT_PROTECTED: ['接收数据仍有未完成的入库任务，暂时不能删除', 'Unfinished ingestion jobs still use this receiving data. It cannot be deleted yet.'],
  INGESTION_AUTHORIZATION_REVOKED: ['入库授权已失效，请恢复授权后重试', 'Ingestion authorization was revoked. Restore authorization before retrying.'],
  INGESTION_PROCESSING_FAILED: ['入库处理失败，请核查任务后重试', 'Ingestion processing failed. Review the job before retrying.'],
  INGESTION_QUEUE_BLOCKED: ['接口队列已暂停或阻塞，请检查任务状态', 'The interface queue is paused or blocked. Check the job status.'],
  INGESTION_STALE_CONFIRMATION: ['档案或来源已变化，请刷新差异后重新确认', 'The record or source changed. Refresh differences before confirming.'],
  INGESTION_CAPACITY_UNAVAILABLE: ['处理容量不足，请核对处理规模和积压任务', 'Ingestion capacity is unavailable. Check the import size and job backlog.'],
  INGESTION_HISTORY_LIMIT_EXCEEDED: ['请重新生成历史预览', 'Generate a new historical preview.'],
  INGESTION_PREVIEW_LIMIT_EXCEEDED: ['临时预览已达上限，请稍后重试', 'Temporary preview capacity is full. Retry later.'],
  INTEGRATION_ENDPOINT_NOT_FOUND: ['接收接口不存在或不可用', 'The receiving interface does not exist or is unavailable'],
  INTEGRATION_RECEIPT_NOT_FOUND: ['接收记录不存在或不可访问', 'The receiving record does not exist or is unavailable'],
  INTEGRATION_PAYLOAD_EXPIRED: ['接收正文已清理', 'The received payload expired'],
  INTEGRATION_MESSAGE_INVALID: ['接收正文格式无效，或指定数组行不存在', 'The received payload has an invalid format or does not contain the specified row'],
  INTEGRATION_ACCESS_DENIED: ['接收接口已停用或不可访问', 'The receiving interface is disabled or unavailable'],
  INTEGRATION_INPUT_INVALID: ['接口请求或目标档案字段无效', 'The integration request or target record fields are invalid'],
  PROCESS_OPERATION_CODE_CONFLICT: ['该组织已存在此工序编码，请检查目标工序后重试', 'This operation code already exists in the organization. Check the target operation and retry.'],
  PROCESS_OPERATION_CODE_IMMUTABLE: ['工序编码绑定后不能修改', 'An assigned operation code cannot be changed'],
  PROCESS_DEFECT_ARCHIVED: ['目标不良记录已归档，无法更新', 'The target defect record is archived and cannot be updated'],
  PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT: ['来源明细编号已关联其他不良记录', 'The source detail ID is linked to another defect record'],
  PROCESS_DEFECT_MANUAL_CONFIRMATION_REQUIRED: ['来源变更涉及人工维护字段，请核对并确认差异', 'The source changes affect manually maintained fields. Review and confirm the differences.'],
  AI_CONNECTION_INVALID: ['AI 渠道配置无效', 'The AI connection configuration is invalid'],
  AI_CONNECTION_NOT_FOUND: ['AI 渠道不存在或不可访问', 'The AI connection does not exist or is unavailable'],
  AI_CONNECTION_UNAVAILABLE: ['AI 渠道未启用或未配置密钥', 'The AI connection is disabled or has no key configured'],
  AI_CONNECTION_VERSION_CONFLICT: ['AI 渠道配置已变化，请刷新后重试', 'The AI connection changed. Refresh before retrying.'],
  AI_CONNECTION_TARGET_DENIED: ['AI 服务地址不符合安全要求', 'The AI service address does not meet security requirements'],
  AI_CONNECTION_REQUEST_FAILED: ['AI 服务请求失败，请检查渠道状态', 'The AI service request failed. Check the connection status.'],
  AI_CONNECTION_TIMEOUT: ['AI 服务请求超时', 'The AI service request timed out'],
  AI_DESCRIPTION_INPUT_EMPTY: ['AI 整理没有可用输入，请补充来源字段后再处理', 'There is no usable AI input. Complete the source fields before processing again.'],
  AI_DESCRIPTION_INPUT_INVALID: ['AI 整理输入格式无效，请修正来源数据', 'The AI input format is invalid. Correct the source data.'],
  AI_DESCRIPTION_INPUT_TOO_LARGE: ['AI 整理输入超过长度限制，请缩短后再处理', 'The AI input is too large. Shorten it before processing again.'],
  AI_CONNECTION_RESPONSE_INVALID: ['AI 服务未返回符合要求的结果', 'The AI service returned an invalid result'],
  AI_CONNECTION_RESPONSE_TOO_LARGE: ['AI 服务响应超过大小限制', 'The AI service response exceeded the size limit'],
  AI_APPLICATION_INVALID: ['提示词应用配置无效', 'The prompt application configuration is invalid'],
  AI_APPLICATION_NOT_FOUND: ['提示词应用或已发布版本不存在', 'The prompt application or its published revision does not exist'],
  AI_APPLICATION_UNAVAILABLE: ['提示词应用未启用', 'The prompt application is disabled'],
  AI_APPLICATION_VERSION_CONFLICT: ['提示词应用已变化，请刷新后重试', 'The prompt application changed. Refresh before retrying.'],
  CONCURRENCY_CONFLICT: ['配置或档案已变化，请保留输入并刷新后重试', 'Configuration or records changed. Preserve your input and refresh before retrying.'],
  IDEMPOTENCY_REPLAY: ['同一请求编号已用于不同内容，请核对原操作结果', 'This request ID was already used for different content. Check the original outcome.'],
  IDEMPOTENCY_KEY_REQUIRED: ['缺少有效的请求编号，请刷新后重试', 'A valid request ID is required. Refresh before retrying.'],
  CSRF_INVALID: ['请求校验失败，请刷新后重试', 'Request verification failed. Refresh before retrying.'],
  AUTH_REAUTHENTICATION_REQUIRED: ['此操作需要重新验证身份', 'Reauthenticate to perform this action'],
  CLIENT_REAUTHENTICATION_CANCELLED: ['已取消身份验证，操作未提交', 'Reauthentication was cancelled. The action was not submitted.'],
  CLIENT_REAUTHENTICATION_COMPLETED: ['身份验证已完成，请重新提交操作', 'Reauthentication is complete. Submit the action again.'],
  INTERNAL_ERROR: ['服务暂时不可用，请稍后重试或按追踪编号核查', 'The service is temporarily unavailable. Retry later or investigate using the trace ID.'],
};
const issueMessage = (code: string) => typeof code === 'string' && Object.hasOwn(issueMessages, code) ? issueMessages[code] : undefined;

export function ingestionIssue(code: string, english: boolean) {
  const message = issueMessage(code);
  return <><span>{(message ?? ['无法确定入库处理原因，请联系管理员核查', 'The ingestion issue could not be identified. Contact an administrator.'])[english ? 1 : 0]}</span>{message && <small><code>{code}</code></small>}</>;
}

function requestFailure(error: unknown, status?: number): [string, string] {
  if (status === 400 || status === 422) return ['请求内容未通过校验，请核对输入', 'The request failed validation. Check your input.'];
  if (status === 401) return ['会话无效或已过期，请重新登录', 'Your session is invalid or expired. Sign in again.'];
  if (status === 403) return ['当前权限不允许此操作', 'Your current permissions do not allow this action'];
  if (status === 404) return ['请求的资源不存在或不可访问', 'The requested resource does not exist or is unavailable'];
  if (status === 408 || status === 504) return ['请求超时，请稍后重试', 'The request timed out. Retry later.'];
  if (status === 409) return issueMessages.CONCURRENCY_CONFLICT;
  if (status === 410) return ['请求的资源已失效，请刷新后核对', 'The requested resource is no longer available. Refresh and review.'];
  if (status === 429) return ['请求过于频繁，请稍后重试', 'Too many requests. Retry later.'];
  if (status !== undefined && status >= 500) return issueMessages.INTERNAL_ERROR;
  if (error instanceof TypeError) return ['未收到可用响应，请检查网络连接后重试', 'No usable response was received. Check your network connection and retry.'];
  return ['无法确定请求失败原因，请重试或联系管理员核查', 'The cause of the request failure is unknown. Retry or contact an administrator.'];
}

const safeField = (field: string) => field.length <= 160 && field.split('.').length <= 8
  && /^[A-Za-z][A-Za-z0-9_]*(?:\[(?:0|[1-9]\d{0,3})\]|\.[A-Za-z][A-Za-z0-9_]*)*$/.test(field)
  && !/__proto__|prototype|constructor|password|passphrase|secret|token|session|authorization|cookie|objectkey|accesskey|privatekey|apikey|credential|connectionstring|databaseurl/i.test(field.replace(/_/g, ''))
  && !field.split(/[.\[\]]/).some(part => Object.hasOwn(Object.prototype, part));

export function IngestionError({ error, title, unknown = false, unknownTitle }: { error?: unknown; title?: string; unknown?: boolean; unknownTitle?: string }) {
  const text = useIngestionText();
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : undefined;
  const status = apiError?.status;
  const message = apiError && issueMessage(apiError.code);
  const code = message ? apiError?.code : status !== undefined && Number.isInteger(status) && status >= 400 && status < 600 ? `HTTP_${status}` : undefined;
  const fields = message && apiError?.fields && typeof apiError.fields === 'object' && !Array.isArray(apiError.fields) ? Object.keys(apiError.fields).filter(safeField) : [];
  const traceId = typeof apiError?.traceId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(apiError.traceId) ? apiError.traceId : undefined;
  return <Alert role="alert" type="error" showIcon title={unknown
    ? unknownTitle ?? text('操作结果未确认，请重试原请求；当前输入已锁定', 'The outcome is unknown. Retry the original request; inputs are locked.')
    : title ?? text(...(message ?? requestFailure(error, status)))}
    description={(code || traceId || fields.length > 0) ? <>
      {fields.length > 0 && <div>{text('字段', 'Fields')}: <code>{fields.join(', ')}</code></div>}
      {code && <div>{text('错误码', 'Error code')}: <code>{code}</code></div>}
      {traceId && <div>{text('追踪编号', 'Trace ID')}: <code>{traceId}</code></div>}
    </> : undefined} />;
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

export function IngestionFields({ fields, differences, registrationIssues }: Pick<components['schemas']['IngestionPreviewDto'], 'fields' | 'registrationIssues'> & { differences?: components['schemas']['IngestionDifferenceDto'][] }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const factoryIssues = registrationIssues?.flatMap(code => factoryIssue(code, english) ?? []) ?? [];
  const valueLabel = (field: string, value: string | null) => {
    if (field === 'factoryCode') return factoryLabel(value, english);
    if (field === 'registrationIssues' && value) return value.split('\n').map(code => factoryIssue(code, english) ?? code).join('\n');
    return value ?? '—';
  };
  return <div className="qms-ingestion-section">
    {fields && <Descriptions size="small" bordered column={1} items={Object.entries(fields).map(([field, value]) => ({ key: field, label: label(field, english), children: <span className="qms-ingestion-field-value">{valueLabel(field, value)}</span> }))} />}
    {factoryIssues.length > 0 && <div className="qms-ingestion-counts">{factoryIssues.map(issue => <Tag key={issue} color="warning">{issue}</Tag>)}</div>}
    {!!differences?.length && <Table size="small" rowKey="field" pagination={false} dataSource={differences} scroll={{ x: 480 }} columns={[
      { key: 'field', title: text('字段', 'Field'), dataIndex: 'field', render: value => label(value, english) },
      { key: 'before', title: text('原值', 'Before'), dataIndex: 'before', render: (value, row) => <span className="qms-ingestion-field-value">{valueLabel(row.field, value)}</span> },
      { key: 'after', title: text('新值', 'After'), dataIndex: 'after', render: (value, row) => <span className="qms-ingestion-field-value">{valueLabel(row.field, value)}</span> },
    ]} />}
  </div>;
}

export function ProcessIngestionResult({ result, organizationId }: { result: Pick<components['schemas']['IngestionItemDto'], 'targetId' | 'pendingCompletion' | 'pendingConfiguration' | 'defectQuantity'> | Pick<components['schemas']['IngestionPreviewDto'], 'targetId' | 'pendingCompletion' | 'pendingConfiguration' | 'defectQuantity'>; organizationId: string }) {
  const text = useIngestionText();
  return <div className="qms-ingestion-counts">
    {result.targetId ? <Link to={`/app/process-quality?organizationId=${encodeURIComponent(organizationId)}&defectId=${encodeURIComponent(result.targetId)}`}>{text('查看台账', 'View ledger')}</Link> : null}
    {result.pendingCompletion ? <Tag color="warning">{text('待完善', 'Incomplete facts')}</Tag> : null}
    {result.pendingConfiguration ? <Tag color="processing">{text('待补配', 'Pending configuration')}</Tag> : null}
    {result.defectQuantity != null ? <span>{text('不良数量', 'Defect quantity')}: {result.defectQuantity}</span> : null}
  </div>;
}
