import type {
  AccountType, ApiErrorPayload, CsrfResponse, LoginRequest, LoginResponse, SessionResponse,
} from '@qms/contracts';

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
