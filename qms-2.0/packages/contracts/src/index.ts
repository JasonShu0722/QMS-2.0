import type { components } from './generated/api.js';

export type { components, operations, paths } from './generated/api.js';
export type LoginRequest = components['schemas']['LoginDto'];
export type LoginResponse = components['schemas']['LoginResponseDto'];
export type SessionResponse = components['schemas']['SessionResponseDto'];
export type CsrfResponse = components['schemas']['CsrfResponseDto'];
export type ApiErrorPayload = components['schemas']['ErrorResponse'];
export type AccountType = SessionResponse['user']['accountType'];

export const PLATFORM_ERROR_CODES = [
  'PROBLEM_NOT_FOUND',
  'NUMBERING_CONFLICT',
  'WORKFLOW_VERSION_IMMUTABLE',
  'WORKFLOW_NODE_FORBIDDEN',
  'IDEMPOTENCY_REPLAY',
  'CONCURRENCY_CONFLICT',
] as const;
export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export type ProblemDomainCode = 'GENERAL' | 'PROCESS' | 'PRODUCT' | 'SERVICE' | 'COMPLIANCE';
export type ProblemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'ARCHIVED';
export type ResponseForm = 'BRIEF' | 'EIGHT_D';
export type WorkflowNodeType = 'ACTION' | 'APPROVAL' | 'VERIFICATION' | 'CC' | 'REJECT' | 'RETURN' | 'REOPEN' | 'CLOSE';
export type WorkflowVersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'OVERDUE';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
