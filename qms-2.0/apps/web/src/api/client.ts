import type {
  AccountProfile, AccountSession, AccountType, ApiErrorPayload, ChangePasswordRequest, CsrfResponse, LoginRequest, LoginResponse, SessionResponse, UpdateAccountProfileRequest,
} from '@qms/contracts';
import type { components } from '@qms/contracts';
import type { GovernanceBody } from '../features/governance/governance';

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
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await parseJson<T | ApiErrorPayload>(response);
  if (!response.ok) {
    if (canReauthenticate && reauthenticate && (payload as Partial<ApiErrorPayload>)?.code === 'AUTH_REAUTHENTICATION_REQUIRED') {
      await reauthenticate();
      if (options.replayAfterReauthentication === false) {
        throw new ApiError({ code: 'CLIENT_REAUTHENTICATION_COMPLETED', message: '身份验证已完成，请重新提交操作' });
      }
      const token = await csrfToken();
      return request<T>(path, { ...init, headers: { ...init.headers, 'x-csrf-token': token } }, options, false);
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

type AdminBody = components['schemas']['CreateAdminUserDto'] | components['schemas']['UpdateAdminUserDto'] |
  components['schemas']['CreateAdminUserBatchDto'] | components['schemas']['ResetTemporaryPasswordDto'] |
  components['schemas']['ResetAdminUserPasswordDto'] | components['schemas']['CreateAdminRoleDto'] |
  components['schemas']['UpdateAdminRoleDto'] | components['schemas']['CopyAdminRoleDto'] | components['schemas']['AssignAdminRolesDto'] | GovernanceBody;

export function createAdminMutation() {
  let pending: { signature: string; key: string } | undefined;
  return async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: AdminBody): Promise<T> {
    const signature = JSON.stringify([path, method, body]);
    if (pending?.signature !== signature) pending = { signature, key: crypto.randomUUID() };
    const attempt = pending;
    const token = await csrfToken();
    const result = await request<T>(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (pending === attempt) pending = undefined;
    return result;
  };
}

export function safeAccountError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '请求失败，请重试';
  const messages: Record<string, string> = {
    AUTH_INVALID_CREDENTIALS: '用户名或密码错误',
    AUTH_PASSWORD_CHANGE_INVALID: '首次改密验证已失效，请重新登录',
    ADMIN_BATCH_ROW_INVALID: '请检查账号导入行的填写内容',
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

export async function csrfToken(): Promise<string> {
  const response = await request<CsrfResponse>('/api/v1/auth/csrf');
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
}

export async function getSession(): Promise<SessionView> {
  const response = await request<SessionResponse>('/api/v1/auth/session');
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

export function getAccountProfile(): Promise<AccountProfile> {
  return request<AccountProfile>('/api/v1/me');
}

export async function updateAccountProfile(body: UpdateAccountProfileRequest): Promise<AccountProfile> {
  const token = await csrfToken();
  return request<AccountProfile>('/api/v1/me', {
    method: 'PATCH',
    headers: { 'x-csrf-token': token },
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

export async function revokeAccountSession(sessionId: string): Promise<void> {
  const token = await csrfToken();
  await request<void>(`/api/v1/me/sessions/${sessionId}/revoke`, {
    method: 'POST',
    headers: { 'x-csrf-token': token },
  });
}
