export type AccountType = 'INTERNAL' | 'SUPPLIER';

export type LoginResponse = {
  accountType: AccountType;
  landingPath: '/app/workbench' | '/supplier/inbox';
};

export type SessionResponse = {
  accountType: AccountType;
  landingPath: '/app/workbench' | '/supplier/inbox';
  userId?: string;
  organizationId?: string;
};

export type ApiErrorPayload = {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  traceId?: string;
};

export class ApiError extends Error {
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly traceId?: string;

  constructor(payload: ApiErrorPayload) {
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
    };
    throw new ApiError({ ...fallback, ...(payload as Partial<ApiErrorPayload>) });
  }
  return payload as T;
}

export async function csrfToken(): Promise<string> {
  const response = await request<{ csrfToken: string }>('/api/v1/auth/csrf');
  return response.csrfToken;
}

export async function login(credentials: { identifier: string; password: string }): Promise<LoginResponse> {
  const token = await csrfToken();
  return request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    body: JSON.stringify(credentials),
  });
}

export async function getSession(): Promise<SessionResponse> {
  const response = await request<
    | {
        user: {
          id: string;
          organizationId: string;
          accountType: AccountType;
        };
        accountType?: AccountType;
        landingPath?: SessionResponse['landingPath'];
      }
    | SessionResponse
  >('/api/v1/auth/session');

  const accountType = 'user' in response ? response.user.accountType : response.accountType;
  const landingPath =
    response.landingPath ??
    (accountType === 'SUPPLIER' ? '/supplier/inbox' : '/app/workbench');

  return {
    accountType,
    landingPath,
    userId: 'user' in response ? response.user.id : response.userId,
    organizationId: 'user' in response ? response.user.organizationId : response.organizationId,
  };
}
