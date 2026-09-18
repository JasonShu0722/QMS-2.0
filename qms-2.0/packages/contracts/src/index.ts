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
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_REQUIRED',
  'AUTH_RATE_LIMITED',
  'CSRF_INVALID',
  'FEATURE_PERMISSION_DENIED',
  'ORGANIZATION_SCOPE_AMBIGUOUS',
  'ORGANIZATION_SCOPE_DENIED',
  'WORKFLOW_PERMISSION_REQUIRED',
] as const;
export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export const PLATFORM_ERROR_MESSAGES: Record<PlatformErrorCode, string> = {
  PROBLEM_NOT_FOUND: '问题记录不存在',
  NUMBERING_CONFLICT: '问题编号分配冲突，请重试',
  WORKFLOW_VERSION_IMMUTABLE: '已发布的流程版本不可修改',
  WORKFLOW_NODE_FORBIDDEN: '当前用户无权执行此流程节点',
  IDEMPOTENCY_REPLAY: '请求已处理，不能重复提交不同内容',
  CONCURRENCY_CONFLICT: '记录已被其他用户更新，请刷新后重试',
  AUTH_INVALID_CREDENTIALS: '用户名或密码错误',
  AUTH_SESSION_REQUIRED: '请先登录',
  AUTH_RATE_LIMITED: '请求过于频繁，请稍后重试',
  CSRF_INVALID: '请求校验失败，请刷新后重试',
  FEATURE_PERMISSION_DENIED: '当前用户无权执行此操作',
  ORGANIZATION_SCOPE_AMBIGUOUS: '组织范围不明确',
  ORGANIZATION_SCOPE_DENIED: '无权访问该组织范围',
  WORKFLOW_PERMISSION_REQUIRED: '流程权限尚未启用',
};

export type ProblemDomainCode = 'GENERAL' | 'PROCESS' | 'PRODUCT' | 'SERVICE' | 'COMPLIANCE';
export type ProblemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'ARCHIVED';
export type ResponseForm = 'BRIEF' | 'EIGHT_D';
export type WorkflowNodeType = 'ACTION' | 'APPROVAL' | 'VERIFICATION' | 'CC' | 'REJECT' | 'RETURN' | 'REOPEN' | 'CLOSE';
export type WorkflowVersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'OVERDUE';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export const PROBLEM_DOMAIN_CODES = ['GENERAL', 'PROCESS', 'PRODUCT', 'SERVICE', 'COMPLIANCE'] as const;
export const PROBLEM_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'] as const;
export const RESPONSE_FORMS = ['BRIEF', 'EIGHT_D'] as const;
export const WORKFLOW_NODE_TYPES = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] as const;
export const WORKFLOW_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'OVERDUE'] as const;
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
