import type { components } from './generated/api.js';

export type { components, operations, paths } from './generated/api.js';
export type LoginRequest = components['schemas']['LoginDto'];
export type LoginResponse = components['schemas']['LoginResponseDto'];
export type SessionResponse = components['schemas']['SessionResponseDto'];
export type CsrfResponse = components['schemas']['CsrfResponseDto'];
export type ApiErrorPayload = components['schemas']['ErrorResponse'];
export type AccountType = SessionResponse['user']['accountType'];
