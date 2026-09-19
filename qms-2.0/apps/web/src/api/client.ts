import type {
  AccountProfile, AccountSession, AccountType, ApiErrorPayload, ChangePasswordRequest, CsrfResponse, LoginRequest, LoginResponse, SessionResponse, UpdateAccountProfileRequest,
} from '@qms/contracts';
import type { components } from '@qms/contracts';

export type { AccountType, LoginResponse } from '@qms/contracts';

export type SessionView = {
  accountType: AccountType;
  landingPath: LoginResponse['landingPath'];
  userId: SessionResponse['user']['id'];
  organizationId: SessionResponse['user']['organizationId'];
};

export class ApiError extends Error {
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly traceId?: string;

  constructor(payload: Pick<ApiErrorPayload, 'code' | 'message'> & Partial<ApiErrorPayload>) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.fields = payload.fields ?? {};
    this.traceId = payload.traceId;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await response.json()) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    const fallback: ApiErrorPayload = {
      code: `HTTP_${response.status}`,
      message: '请求无法处理',
      fields: {},
      traceId: '',
    };
    throw new ApiError({ ...fallback, ...(payload as Partial<ApiErrorPayload>) });
  }
  return payload as T;
}

export const apiRequest = request;

type AdminBody = components['schemas']['CreateAdminUserDto'] | components['schemas']['UpdateAdminUserDto'] |
  components['schemas']['ResetAdminUserPasswordDto'] | components['schemas']['CreateAdminRoleDto'] |
  components['schemas']['UpdateAdminRoleDto'] | components['schemas']['CopyAdminRoleDto'] | components['schemas']['AssignAdminRolesDto'];

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
    ADMIN_USER_ORGANIZATION_IN_USE: '该用户仍关联业务记录，无法变更主组织',
    ADMIN_ROLE_IN_USE: '角色仍在使用，请先解除用户分配',
    ADMIN_USER_DUPLICATE: '用户名或邮箱已存在',
    ADMIN_ROLE_DUPLICATE: '角色代码已存在',
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

export async function getSession(): Promise<SessionView> {
  const response = await request<SessionResponse>('/api/v1/auth/session');
  const accountType = response.user.accountType;
  const landingPath = accountType === 'SUPPLIER' ? '/supplier/inbox' : '/app/workbench';

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
