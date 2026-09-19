import type { components } from './generated/api.js';

export type { components, operations, paths } from './generated/api.js';
export type LoginRequest = components['schemas']['LoginDto'];
export type LoginResponse = components['schemas']['LoginResponseDto'];
export type SessionResponse = components['schemas']['SessionResponseDto'];
export type CsrfResponse = components['schemas']['CsrfResponseDto'];
export type ApiErrorPayload = components['schemas']['ErrorResponse'];
export type AccountType = SessionResponse['user']['accountType'];

export type PlatformErrorCode = components['schemas']['PlatformErrorCode'];
export type ProblemDomainCode = components['schemas']['PlatformTypesDto']['problemDomainCode'];
export type ProblemStatus = components['schemas']['ProblemStatus'];
export type ResponseForm = components['schemas']['ResponseForm'];
export type WorkflowNodeType = components['schemas']['WorkflowNodeType'];
export type WorkflowVersionStatus = components['schemas']['WorkflowVersionStatus'];
export type TaskStatus = components['schemas']['TaskStatus'];
export type NotificationStatus = components['schemas']['NotificationStatus'];
