import type {
  AccountProfile, AccountSession, AccountType, ApiErrorPayload, ChangePasswordRequest, CsrfResponse, LoginRequest, LoginResponse, SessionResponse, UpdateAccountProfileRequest,
} from '@qms/contracts';
import type { components } from '@qms/contracts';
import type { GovernanceBody } from '../features/governance/governance';
import { clearAccountAvatar } from '../features/account/account-avatar-state';
import { publishSessionSignal, sessionSignalVersion } from '../features/auth/session-invalidation';

export type { AccountType, LoginResponse } from '@qms/contracts';

export type SessionView = {
  accountType: AccountType;
  landingPath: SessionResponse['landingPath'];
  userId: SessionResponse['user']['id'];
  organizationId: SessionResponse['user']['organizationId'];
};

export class ApiError extends Error {
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly traceId?: string;
  readonly status?: number;

  constructor(payload: Pick<ApiErrorPayload, 'code' | 'message'> & Partial<ApiErrorPayload>, status?: number) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.fields = payload.fields ?? {};
    this.traceId = payload.traceId;
    this.status = status;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await response.json()) as T;
}

let reauthenticate: (() => Promise<void>) | undefined;
export function registerReauthentication(handler: () => Promise<void>) {
  reauthenticate = handler;
  return () => { if (reauthenticate === handler) reauthenticate = undefined; };
}

async function request<T>(path: string, init: RequestInit = {}, options: { replayAfterReauthentication?: boolean } = {}, canReauthenticate = true): Promise<T> {
  init.signal?.throwIfAborted();
  const version = sessionSignalVersion();
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  let responseVersion = version;
  // Cookies and successful writes already took effect, even if their caller or body is obsolete.
  if (response.ok && init.method && init.method !== 'GET') {
    if (['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/mfa/verify', '/api/v1/auth/password-change/complete'].includes(path)) {
      responseVersion++; publishSessionSignal('invalidate');
    } else if (path.startsWith('/api/v1/admin/') || path.startsWith('/api/v1/organizations/') || ['/api/v1/me/password', '/api/v1/me/mfa/enrollment/confirm', '/api/v1/me/mfa/recovery-codes', '/api/v1/auth/password-reset/complete', '/api/v1/auth/password-recovery/complete'].includes(path) || path.startsWith('/api/v1/me/sessions/')) publishSessionSignal('revalidate');
  }
  init.signal?.throwIfAborted();
  if (responseVersion !== sessionSignalVersion()) throw new DOMException('Session changed', 'AbortError');
  let payload: T | ApiErrorPayload | undefined;
  try { payload = await parseJson<T | ApiErrorPayload>(response); } catch (error) { if (response.ok) throw error; }
  init.signal?.throwIfAborted();
  if (responseVersion !== sessionSignalVersion()) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    const code = (payload as Partial<ApiErrorPayload>)?.code;
    if (canReauthenticate && reauthenticate && code === 'AUTH_REAUTHENTICATION_REQUIRED') {
      await reauthenticate();
      init.signal?.throwIfAborted();
      if (responseVersion !== sessionSignalVersion()) throw new DOMException('Session changed', 'AbortError');
      if (options.replayAfterReauthentication === false) {
        throw new ApiError({ code: 'CLIENT_REAUTHENTICATION_COMPLETED', message: '身份验证已完成，请重新提交操作' });
      }
      const token = await csrfToken(init.signal ?? undefined);
      init.signal?.throwIfAborted();
      if (responseVersion !== sessionSignalVersion()) throw new DOMException('Session changed', 'AbortError');
      return request<T>(path, { ...init, headers: { ...init.headers, 'x-csrf-token': token } }, options, false);
    }
    // Auth probes and the console guard handle their own refusal without notification loops.
    if (!path.startsWith('/api/v1/auth/') && !path.startsWith('/api/v1/admin/console/context') && code !== 'AUTH_REAUTHENTICATION_REQUIRED') {
      const inputRejected = path === '/api/v1/me/password' && code === 'AUTH_CURRENT_PASSWORD_INVALID'
        || ['/api/v1/me/reauthenticate', '/api/v1/me/mfa/enrollment/confirm'].includes(path) && code === 'AUTH_MFA_CODE_INVALID';
      if (response.status === 401) publishSessionSignal(inputRejected ? 'revalidate' : 'invalidate');
      else if (response.status === 403) publishSessionSignal('revalidate');
    }
    const fallback: ApiErrorPayload = {
      code: `HTTP_${response.status}`,
      message: '请求无法处理',
      fields: {},
      traceId: '',
    };
    throw new ApiError({ ...fallback, ...(payload as Partial<ApiErrorPayload>) }, response.status);
  }
  return payload as T;
}

export const apiRequest = request;

export function getAdminUser(organizationId: string, userId: string): Promise<components['schemas']['AdminUserDto']> {
  return request<components['schemas']['AdminUserDto']>(`/api/v1/admin/users/${encodeURIComponent(userId)}?organizationId=${encodeURIComponent(organizationId)}`);
}

type AdminBody = components['schemas']['CreateAdminUserDto'] | components['schemas']['UpdateAdminUserDto'] |
  components['schemas']['DeleteAdminUserDto'] | components['schemas']['OrganizationForceDeleteDto'] |
  components['schemas']['AdministrativeReconfigurationDto'] |
  components['schemas']['LegacyAuthorizationPreviewInputDto'] | components['schemas']['LegacyAuthorizationCommitDto'] |
  components['schemas']['AdministrativeProblemReconfigureDto'] |
  components['schemas']['CreateAdminUserBatchDto'] | components['schemas']['ResetTemporaryPasswordDto'] |
  components['schemas']['ResetAdminUserPasswordDto'] | components['schemas']['CreateAdminRoleDto'] |
  components['schemas']['UpdateAdminRoleDto'] | components['schemas']['CopyAdminRoleDto'] | components['schemas']['AssignAdminRolesDto'] |
  components['schemas']['DecideWorkflowClosureRoundDto'] | components['schemas']['CreateWorkflowClosureTemplateDto'] | GovernanceBody;

export function createAdminMutation(options: { replayAfterReauthentication?: boolean } = {}) {
  let pending: { signature: string; key: string } | undefined;
  return async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: AdminBody, signal?: AbortSignal): Promise<T> {
    const version = sessionSignalVersion();
    const signature = JSON.stringify([path, method, body]);
    if (pending?.signature !== signature) pending = { signature, key: crypto.randomUUID() };
    const attempt = pending;
    const token = await csrfToken(signal);
    signal?.throwIfAborted();
    if (version !== sessionSignalVersion()) throw new DOMException('Session changed', 'AbortError');
    const result = await request<T>(path, { method, signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: body === undefined ? undefined : JSON.stringify(body) }, options);
    if (pending === attempt) pending = undefined;
    return result;
  };
}

export function safeAccountError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '请求失败，请重试';
  const messages: Record<string, string> = {
    PROCESS_EIGHT_D_CONFIGURATION_REQUIRED: '尚未绑定并启用制程8D流程，请联系流程管理员',
    PROCESS_EIGHT_D_CONFIGURATION_INVALID: '制程8D绑定版本不符合受控规则，请检查流程配置',
    PROCESS_EIGHT_D_APPROVAL_LOCKED: '报告正在审批，当前版本已锁定',
    PROCESS_EIGHT_D_ANALYSIS_INCOMPLETE: '请完善发生因、流出因总结及对应对策计划',
    PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE: '请完善措施实施、改善前后、首批断点、后续跟进和有效性确认',
    PROCESS_EIGHT_D_DOCUMENT_INVALID: '报告字段或明细行格式不符合要求，请检查后保存',
    PROCESS_EIGHT_D_SOURCE_CONFIRMATION_REQUIRED: '关联来源已有单据或关联已变化，请重新预览并确认是否复发',
    PROCESS_EIGHT_D_SOURCE_CONFIRMATION_INVALID: '来源确认不完整，请重新选择并确认',
    PROCESS_EIGHT_D_CANCEL_APPROVAL_CONFIRMATION_REQUIRED: '调整将取消本轮审批，确认后须重新提交',
    PROCESS_EIGHT_D_CLOSED_SOURCES_APPEND_ONLY: '问题已关闭，只能补充来源，原批准版保持不变',
    PROCESS_EIGHT_D_OWNER_ASSIGNMENT_INVALID: '负责人在所选科室没有有效任职，请重新选择',
    PROCESS_EIGHT_D_COLLABORATOR_INVALID: '协作人员已失效或没有办理权限',
    PROCESS_EIGHT_D_DUE_AT_INVALID: '计划日期不符合当前阶段要求，请检查日期',
    PROCESS_EIGHT_D_EXTENSION_REQUIRED: '不能直接顺延已有期限，请提交延期申请',
    PROCESS_EIGHT_D_EVIDENCE_NOT_CLEAN: '附件尚未完成安全扫描或验证，请稍后刷新',
    PROCESS_EIGHT_D_REPORT_APPROVED_UNAVAILABLE: '尚无批准关闭版，请查看当前草稿',
    PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT: '报告或附件版本已变化，请刷新后重新生成',
    PROCESS_EIGHT_D_REPORT_EVIDENCE_UNPINNED: '历史附件缺少固定版本证据，暂不能生成报告',
    PROCESS_PRODUCTION_QUANTITY_INCOMPLETE: '关联不良数量尚未补全，不能生成完整出货报告',
    PROCESS_DEFECT_STATUS_CONFLICT: '台账状态已变化，请刷新后重试',
    PROCESS_DEFECT_SQE_INVALID: '所选SQE没有有效任职或物料复核权限',
    AUTH_INVALID_CREDENTIALS: '用户名或密码错误',
    AUTH_PASSWORD_CHANGE_INVALID: '首次改密验证已失效，请重新登录',
    ADMIN_BATCH_ROW_INVALID: '请检查账号导入行的填写内容',
    MATERIAL_MASTER_INPUT_INVALID: '请检查物料编码和物料名称',
    MATERIAL_MASTER_NOT_FOUND: '物料不存在或不在当前组织',
    MATERIAL_MASTER_IMPORT_ROW_FAILED: '物料新增失败，请检查数据后重试',
    AUTH_CURRENT_PASSWORD_INVALID: '当前密码错误',
    AUTH_SESSION_REQUIRED: '请先登录',
    AUTH_RATE_LIMITED: '请求过于频繁，请稍后重试',
    AUTH_REAUTHENTICATION_REQUIRED: '此操作需要重新验证身份',
    AUTH_MFA_CODE_INVALID: '验证码无效或已使用，请使用新的验证码',
    AUTH_MFA_CHALLENGE_INVALID: '验证已过期，请重新登录',
    AUTH_MFA_RATE_LIMITED: '验证尝试过多，请稍后重试',
    AUTH_MFA_POLICY_REQUIRED: '账号策略要求启用 MFA',
    AUTH_SECURITY_KEY_UNAVAILABLE: '安全服务暂不可用，请联系管理员',
    AUTH_MAIL_UNAVAILABLE: '邮件服务暂不可用，请联系管理员',
    AUTH_EMAIL_REQUIRED: '请先设置邮箱',
    AUTH_RECOVERY_INVALID: '凭证无效、已使用或已过期',
    AUTH_RECOVERY_UNAVAILABLE: '账号恢复服务暂不可用，请联系管理员',
    EXPORT_TOO_LARGE: '请缩小导出筛选范围，最多 5000 条',
    EXPORT_EXPIRED: '导出已过期，请重新生成',
    EXPORT_NOT_FOUND: '导出记录不存在',
    ORGANIZATION_DISABLED: '组织已停用',
    ORGANIZATION_HIERARCHY_INVALID: '组织层级关系不合法',
    STRUCTURE_REFERENCE_INVALID: '部门、岗位或任职引用不合法',
    STRUCTURE_DISABLED: '部门或岗位已停用',
    ADMIN_USER_ORGANIZATION_IN_USE: '该用户仍关联业务记录，无法变更主组织',
    ADMIN_ROLE_IN_USE: '角色仍在使用，请先解除用户分配',
    ADMIN_USER_DUPLICATE: '用户名或邮箱已存在',
    ADMIN_ROLE_DUPLICATE: '角色代码已存在',
    CONCURRENCY_CONFLICT: '记录已被其他用户更新，请刷新后重试',
    ADMIN_PERMISSION_BASELINE_REQUIRED: '请重新加载角色权限后再保存',
    ADMIN_GLOBAL_ROLE_IMMUTABLE: '全局角色只读，不能通过组织管理变更',
    ADMIN_SELF_DISABLE_FORBIDDEN: '不能停用当前账号',
    ADMIN_SELF_LOCK_FORBIDDEN: '不能移除自身管理权限或变更自身身份',
    ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH: '账号类型与主组织类型不一致',
    AUTH_PASSWORD_RESET_INVALID: '重置凭证无效、已使用或已过期',
    AUTH_PASSWORD_POLICY_INVALID: '密码不符合安全要求，请使用至少 12 位的强密码',
    VALIDATION_FAILED: '请检查填写内容',
    FEATURE_PERMISSION_DENIED: '无权执行此操作',
    POSITION_GRANT_CEILING_DENIED: '所选岗位包含无权授予的权限',
    ORGANIZATION_SCOPE_DENIED: '无权访问该组织',
    CSRF_INVALID: '安全校验失败，请重试',
    RATE_LIMITED: '操作过于频繁，请稍后重试',
  };
  return messages[cause.code] ?? '请求被拒绝，请检查权限和填写内容后重试';
}

export async function completePasswordReset(body: components['schemas']['CompletePasswordResetDto']): Promise<void> {
  const token = await csrfToken();
  await request<void>('/api/v1/auth/password-reset/complete', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
}

export async function csrfToken(signal?: AbortSignal): Promise<string> {
  const response = await request<CsrfResponse>('/api/v1/auth/csrf', { signal });
  return response.csrfToken;
}

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const token = await csrfToken();
  return request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    body: JSON.stringify(credentials),
  });
}

export async function logout(): Promise<void> {
  const token = await csrfToken();
  await request<void>('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': token } });
  clearAccountAvatar();
}

export async function getSession(signal?: AbortSignal): Promise<SessionView> {
  const response = await request<SessionResponse>('/api/v1/auth/session', { signal });
  const accountType = response.user.accountType;
  if (!['/app/workbench', '/supplier/inbox'].includes(response.landingPath) || response.securityState !== 'AUTHENTICATED') {
    throw new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: '登录状态响应无效' });
  }
  const landingPath = response.landingPath;

  return {
    accountType,
    landingPath,
    userId: response.user.id,
    organizationId: response.user.organizationId,
  };
}

export function getAccountProfile(signal?: AbortSignal): Promise<AccountProfile> {
  return request<AccountProfile>('/api/v1/me', { signal });
}

export function getAccountOverview(signal?: AbortSignal): Promise<components['schemas']['AccountOverviewDto']> {
  return request<components['schemas']['AccountOverviewDto']>('/api/v1/me/overview', { signal });
}

export function getMySignatureSummary(signal?: AbortSignal): Promise<components['schemas']['ESignatureSummaryDto'][]> {
  return request<components['schemas']['ESignatureSummaryDto'][]>('/api/v1/e-signatures/mine/summary', { signal });
}

export async function registerMySignature(body: components['schemas']['RegisterESignatureDto'], key: string, signal?: AbortSignal): Promise<components['schemas']['ESignatureDto']> {
  const token = await csrfToken();
  return request<components['schemas']['ESignatureDto']>('/api/v1/e-signatures', {
    method: 'POST', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body),
  });
}

export async function revokeMySignature(id: string, body: components['schemas']['RevokeESignatureDto'], key: string, signal?: AbortSignal): Promise<components['schemas']['ESignatureDto']> {
  const token = await csrfToken();
  return request<components['schemas']['ESignatureDto']>(`/api/v1/e-signatures/${encodeURIComponent(id)}/revoke`, {
    method: 'POST', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body),
  });
}

export async function updateAccountAvatar(body: components['schemas']['UpdateAccountAvatarDto'], key: string, signal?: AbortSignal): Promise<AccountProfile> {
  const token = await csrfToken();
  return request<AccountProfile>('/api/v1/me/avatar', {
    method: 'PATCH', signal,
    headers: { 'x-csrf-token': token, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

export async function updateAccountProfile(body: UpdateAccountProfileRequest, key: string): Promise<AccountProfile> {
  const token = await csrfToken();
  return request<AccountProfile>('/api/v1/me', {
    method: 'PATCH',
    headers: { 'x-csrf-token': token, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

export async function changeAccountPassword(body: ChangePasswordRequest): Promise<void> {
  const token = await csrfToken();
  await request<void>('/api/v1/me/password', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
}

export function getAccountSessions(): Promise<AccountSession[]> {
  return request<AccountSession[]>('/api/v1/me/sessions');
}

export function getAccountSessionHistory(page = 1): Promise<components['schemas']['AccountSessionHistoryPageDto']> {
  return request<components['schemas']['AccountSessionHistoryPageDto']>(`/api/v1/me/sessions/history?page=${page}&pageSize=20`);
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  const token = await csrfToken();
  await request<void>(`/api/v1/me/sessions/${sessionId}/revoke`, {
    method: 'POST',
    headers: { 'x-csrf-token': token },
  });
}
