import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { PasswordResetService } from './password-reset.service.js';
import type { CreateAdminUserDto, AdminUserListQueryDto, UpdateAdminUserDto, AdminMfaPolicyInputDto } from './dto/admin-user.dto.js';
import { userUpdatePermissions } from '../authorization/permission-catalog.js';
import { TemporaryPasswordService } from './temporary-password.service.js';
import { assertRecentAuthentication, mfaPolicy } from '../../common/security/session-security.js';

export type AdminUserActor = AdminActor;
const USER_SELECT = {
  id: true, username: true, email: true, accountType: true, status: true, mfaEnabled: true,
  organizationId: true, createdAt: true, updatedAt: true,
  organization: { select: { id: true, code: true, name: true } },
} as const;

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService, private readonly audit: AuditLogService, private readonly mutations: AdminMutationService, private readonly resets: PasswordResetService, private readonly temporaryPasswords: TemporaryPasswordService) {}

  async list(actor: AdminUserActor, query: AdminUserListQueryDto) {
    const organizationId = query.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId;
    await assertAdminAccess(this.prisma, actor, organizationId, 'account:users:read');
    return this.prisma.user.findMany({
      where: { organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.accountType ? { accountType: query.accountType } : {}),
        ...(query.search ? { OR: [{ username: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } : {}),
      }, select: USER_SELECT, orderBy: [{ status: 'asc' }, { username: 'asc' }],
    });
  }

  async detail(actor: AdminUserActor, userId: string, organizationId = actor.scopeOrganizationId ?? actor.organizationId) {
    await assertAdminAccess(this.prisma, actor, organizationId, 'account:users:read');
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: USER_SELECT });
    if (!user) adminError('ADMIN_USER_NOT_FOUND', 404);
    return user;
  }

  async getMfaPolicy(actor: AdminUserActor, userId: string, organizationId = actor.scopeOrganizationId ?? actor.organizationId) {
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'account:users:read');
      if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
      const user = await transaction.user.findFirst({ where: { id: userId, organizationId } });
      if (!user) adminError('ADMIN_USER_NOT_FOUND', 404);
      const policy = await mfaPolicy(transaction, userId);
      return { userId, required: policy.required, bound: user.mfaEnabled, override: user.mfaRequirementOverride, roleRequired: policy.roleRequired, securityVersion: user.securityVersion, selfSessionRevoked: false };
    });
  }

  setMfaPolicy(actor: AdminUserActor, userId: string, dto: AdminMfaPolicyInputDto, organizationId: string, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'USER_MFA_POLICY_CHANGED', payload: { userId, ...dto }, permission: 'account:users:reset', traceId }, async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.securityVersion !== dto.expectedSecurityVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const changed = user.mfaRequirementOverride !== dto.required;
      if (changed) {
        await transaction.user.update({ where: { id: userId }, data: { mfaRequirementOverride: dto.required, securityVersion: { increment: 1 } } });
        const now = new Date();
        await transaction.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        await transaction.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
        await transaction.passwordChangeChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      }
      const policy = await mfaPolicy(transaction, userId);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'USER_MFA_POLICY_CHANGED', resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId, status: dto.required ? 'ENABLED' : 'DISABLED' } }, transaction);
      return { userId, required: policy.required, bound: user.mfaEnabled, override: dto.required, roleRequired: policy.roleRequired, securityVersion: user.securityVersion + Number(changed), selfSessionRevoked: changed && actor.id === userId };
    }, async (transaction) => {
      if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!(await transaction.user.findFirst({ where: { id: userId, organizationId } }))) adminError('ADMIN_USER_NOT_FOUND', 404);
      await this.assertTarget(transaction, actor, userId, ['account:users:reset']);
    });
  }

  create(actor: AdminUserActor, dto: CreateAdminUserDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId: dto.organizationId, key, action: 'USER_CREATED', payload: dto, permission: 'account:users:create', traceId, duplicateCode: 'ADMIN_USER_DUPLICATE' }, async (transaction) => {
      await this.assertOrganizationAccountType(transaction, dto.organizationId, dto.accountType);
      const passwordHash = await this.passwords.hash(dto.initialPassword);
      const user = await transaction.user.create({ data: { organizationId: dto.organizationId, username: dto.username.trim(), email: dto.email?.trim().toLowerCase() ?? null, accountType: dto.accountType, passwordHash }, select: USER_SELECT });
      await this.record(transaction, actor, dto.organizationId, user.id, 'USER_CREATED', traceId);
      return user;
    });
  }

  update(actor: AdminUserActor, userId: string, dto: UpdateAdminUserDto, organizationId: string, traceId: string, key?: string) {
    const requiredPermissions = userUpdatePermissions(dto);
    const additionalAccess = actor.id !== userId && dto.organizationId && dto.organizationId !== organizationId ? [{ organizationId: dto.organizationId, permission: 'account:users:transfer' }] : [];
    return this.mutations.run({ actor, organizationId, key, action: 'USER_UPDATED', payload: { userId, dto }, permission: requiredPermissions, additionalAccess, traceId, duplicateCode: 'ADMIN_USER_DUPLICATE' }, async (transaction) => {
      const existing = await transaction.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, organizationId: true, accountType: true } });
      if (!existing) adminError('ADMIN_USER_NOT_FOUND', 404);
      const targetOrganizationId = dto.organizationId ?? existing.organizationId;
      const targetType = dto.accountType ?? existing.accountType;
      const identityChanged = targetOrganizationId !== existing.organizationId || targetType !== existing.accountType;
      if (actor.id === userId && dto.status === 'DISABLED') adminError('ADMIN_SELF_DISABLE_FORBIDDEN', 409);
      if (actor.id === userId && identityChanged) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      await this.assertTarget(transaction, actor, userId, requiredPermissions, identityChanged);
      await this.assertOrganizationAccountType(transaction, targetOrganizationId, targetType);
      const organizationChanged = targetOrganizationId !== existing.organizationId;
      if (organizationChanged) {
        const references = await Promise.all([
          transaction.problemIndex.count({ where: { ownerId: userId } }),
          transaction.workflowTask.count({ where: { OR: [{ assigneeUserId: userId }, { claimedByUserId: userId }] } }),
          transaction.notification.count({ where: { recipientUserId: userId } }),
          transaction.userPosition.count({ where: { userId } }),
        ]);
        if (references.some((count) => count > 0)) adminError('ADMIN_USER_ORGANIZATION_IN_USE', 409);
      }
      const user = await transaction.user.update({ where: { id: userId }, data: {
        ...(dto.email !== undefined ? { email: dto.email?.trim().toLowerCase() ?? null } : {}),
        ...(dto.accountType ? { accountType: dto.accountType } : {}),
        ...(dto.organizationId ? { organizationId: dto.organizationId } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(identityChanged || dto.status === 'DISABLED' ? { securityVersion: { increment: 1 } } : {}),
      }, select: USER_SELECT }).catch((error: unknown) => {
        if (organizationChanged && (error as { code?: string }).code === 'P2003') adminError('ADMIN_USER_ORGANIZATION_IN_USE', 409);
        throw error;
      });
      if (identityChanged) await transaction.userRole.deleteMany({ where: { userId } });
      if (identityChanged || dto.status === 'DISABLED') {
        const now = new Date();
        await transaction.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        await transaction.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      }
      await this.record(transaction, actor, organizationId, userId, 'USER_UPDATED', traceId);
      return user;
    });
  }

  resetPassword(actor: AdminUserActor, userId: string, temporaryCode: string, organizationId: string, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'PASSWORD_RESET_ISSUED', payload: { userId, temporaryCode }, permission: 'account:users:reset', traceId }, async (transaction) => {
      const existing = await transaction.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!existing) adminError('ADMIN_USER_NOT_FOUND', 404);
      await this.assertTarget(transaction, actor, userId, ['account:users:reset']);
      const result = await this.resets.issue(transaction, userId, temporaryCode);
      await this.record(transaction, actor, organizationId, userId, 'PASSWORD_RESET_ISSUED', traceId);
      return result;
    });
  }

  async resetTemporaryPassword(actor: AdminUserActor, userId: string, temporaryPassword: string | undefined, organizationId: string, traceId: string, key?: string) {
    if (actor.id === userId) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
    const result = await this.mutations.run({ actor, organizationId, key, action: 'TEMPORARY_PASSWORD_RESET', payload: { userId, temporaryPassword }, permission: 'account:users:reset', traceId }, async (transaction) => {
      const metadata = await this.temporaryPasswords.reset(transaction, userId, temporaryPassword);
      await this.record(transaction, actor, organizationId, userId, 'TEMPORARY_PASSWORD_RESET', traceId);
      return metadata;
    }, (transaction) => this.assertTemporaryPasswordTarget(transaction, actor, userId, organizationId));
    return this.readTemporaryPassword(actor, userId, organizationId, traceId, result.credentialVersion);
  }

  async readTemporaryPassword(actor: AdminUserActor, userId: string, organizationId: string, traceId: string, expectedVersion?: number) {
    return this.prisma.$transaction(async (transaction) => {
      await assertRecentAuthentication(transaction, actor);
      await this.assertTemporaryPasswordTarget(transaction, actor, userId, organizationId);
      const result = await this.temporaryPasswords.project(transaction, userId, expectedVersion);
      await this.record(transaction, actor, organizationId, userId, 'TEMPORARY_PASSWORD_READ', traceId);
      return result;
    });
  }

  async assertTemporaryPasswordTarget(transaction: AdminTransaction, actor: AdminActor, userId: string, organizationId: string) {
    await assertAdminAccess(transaction, actor, organizationId, 'account:users:reset');
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await transaction.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' } });
    if (!user) adminError('ADMIN_USER_NOT_FOUND', 404);
    await this.assertTarget(transaction, actor, userId, ['account:users:reset']);
  }

  async assertTarget(transaction: AdminTransaction, actor: AdminActor, userId: string, requiredPermissions: string[], identityChanged = false) {
    const assignments = await transaction.userRole.findMany({ where: { userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    if (identityChanged && assignments.some((assignment) => assignment.role.organizationId === null)) adminError('ADMIN_GLOBAL_ROLE_IMMUTABLE', 409);
    for (const organizationId of new Set(assignments.map((assignment) => assignment.organizationId))) {
      const granted = await assertAdminAccess(transaction, actor, organizationId, requiredPermissions);
      const targetPermissions = assignments.filter((assignment) => assignment.organizationId === organizationId).flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code));
      if (targetPermissions.some((code) => !granted.includes(code))) adminError('FEATURE_PERMISSION_DENIED', 403);
    }
  }

  async assertOrganizationAccountType(transaction: AdminTransaction, organizationId: string, accountType: string) {
    const organization = await transaction.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (!organization || organization.type !== accountType) adminError('ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', 400);
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, action: string, traceId: string) {
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId } }, transaction);
  }
}
