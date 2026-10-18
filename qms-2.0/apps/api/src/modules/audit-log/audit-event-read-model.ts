import type { Prisma } from '../../generated/prisma/client.js';
import type { AuditActorSummaryDto } from './audit-query.dto.js';

// 审计专用跨模块读取模型：只选当前资料摘要，不能将 User 全量投影到审计响应。
export const auditEventReadSelect = {
  id: true, organizationId: true, actorUserId: true, action: true, resourceType: true,
  resourceId: true, outcome: true, traceId: true, createdAt: true,
  actor: { select: { username: true, accountType: true, organizationId: true, organization: { select: { name: true } } } },
} as const satisfies Prisma.AuditEventSelect;

const actionLabels: Readonly<Record<string, string>> = {
  LOGIN_FAILED: '登录失败', PASSWORD_RESET_REQUESTED: '申请重置密码', PERMISSION_CHANGED: '变更权限',
  SESSION_REVOKED: '撤销会话', ATTACHMENT_UPLOAD_INITIALIZED: '初始化附件上传', ACTION_REJECTED: '操作被拒绝',
  USER_CREATED: '创建用户', USER_UPDATED: '更新用户', USER_MFA_POLICY_CHANGED: '变更用户 MFA 策略',
  PROFILE_UPDATED: '更新个人资料', PASSWORD_CHANGED: '修改密码', PASSWORD_RESET: '重置密码',
  PASSWORD_RESET_ISSUED: '签发密码重置凭证', TEMPORARY_PASSWORD_RESET: '设置临时密码', TEMPORARY_PASSWORD_READ: '查看临时密码',
  CONFIG_UPDATED: '更新平台配置', AUDIT_EXPORT_CREATED: '创建审计导出', AUDIT_EXPORT_DOWNLOADED: '下载审计导出', AUDIT_EXPORT_DENIED: '审计导出被拒绝',
  ORGANIZATION_CREATED: '创建组织', ORGANIZATION_UPDATED: '更新组织', DEPARTMENT_CREATED: '创建部门', DEPARTMENT_UPDATED: '更新部门',
  POSITION_CREATED: '创建岗位', POSITION_UPDATED: '更新岗位', USER_POSITIONS_REPLACED: '调整用户任职',
  ROLE_CREATED: '创建角色', ROLE_UPDATED: '更新角色', ROLE_DELETED: '删除角色', USER_ROLES_REPLACED: '调整用户角色', USER_ROLES_CHANGED: '变更用户角色',
  EMAIL_VERIFICATION_REQUESTED: '申请邮箱验证', PASSWORD_RECOVERY_REQUESTED: '申请找回密码',
  EMAIL_RECOVERY_RATE_LIMITED: '邮箱找回受到限流', MFA_VERIFICATION_REJECTED: 'MFA 验证被拒绝',
};

export function auditActionLabel(action: string): string {
  return Object.hasOwn(actionLabels, action) ? actionLabels[action]! : action;
}

export function auditActorSummary(event: Prisma.AuditEventGetPayload<{ select: typeof auditEventReadSelect }>): AuditActorSummaryDto | null {
  const actor = event.actor;
  if (!actor || actor.organizationId !== event.organizationId) return null;
  return { username: actor.username, accountType: actor.accountType, organizationName: actor.organization.name };
}
