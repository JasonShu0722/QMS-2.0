import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../../common/contracts/platform-error.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { AdminUserActor } from '../identity/admin-user.service.js';
import type { AssignAdminRolesDto, CopyAdminRoleDto, CreateAdminRoleDto, UpdateAdminRoleDto } from './admin-role.dto.js';
import { AdminMutationService, assertAdminAccess } from '../../common/security/admin-mutation.service.js';
import { ACTIVE_PERMISSION_CODES, ADMIN_PERMISSIONS, PERMISSION_CATALOG } from './permission-catalog.js';
import { effectivePositionAssignmentWhere, effectiveRoleGrants, type EffectiveRoleGrant } from '../../common/security/effective-role-grants.js';
import { SUPPLIER_PORTAL_PERMISSIONS } from './supplier-account-authorization.js';

type Transaction = Prisma.TransactionClient;
const ROLE_INCLUDE = { permissions: { include: { permission: true } } } as const;

@Injectable()
export class AdminRoleService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly mutations: AdminMutationService) {}

  async permissions(actor: AdminUserActor) {
    await this.assertRead(actor);
    return this.prisma.permission.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
  }

  async catalog(actor: AdminUserActor) {
    const granted = await assertAdminAccess(this.prisma, actor, this.scope(actor), 'account:roles:read');
    const records = await this.prisma.permission.findMany({ where: { code: { in: ACTIVE_PERMISSION_CODES } }, select: { code: true } });
    const existing = new Set(records.map((permission) => permission.code));
    return PERMISSION_CATALOG.map((group) => ({ ...group, modules: group.modules.map((module) => ({ ...module, operations: module.operations.map((operation) => ({ ...operation, grantable: existing.has(operation.code) && granted.includes(operation.code) })) })) }));
  }

  async list(actor: AdminUserActor) {
    const organizationId = this.scope(actor);
    await this.assertRead(actor);
    const roles = await this.prisma.role.findMany({ where: { organizationId }, include: ROLE_INCLUDE, orderBy: { code: 'asc' } });
    return roles.map((role) => this.serialize(role));
  }

  async detail(actor: AdminUserActor, roleId: string) {
    await this.assertRead(actor);
    return this.serialize(await this.role(this.prisma, roleId, this.scope(actor)));
  }

  create(actor: AdminUserActor, dto: CreateAdminRoleDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, { action: 'ROLE_CREATED', permission: 'account:roles:create', payload: dto, traceId, key }, async (transaction, granted) => {
      if (dto.organizationId !== organizationId) this.fail('ORGANIZATION_SCOPE_DENIED', 403);
      const permissions = await this.resolvePermissions(transaction, dto.permissionCodes, granted);
      const role = await transaction.role.create({
        data: { organizationId, code: dto.code, name: dto.name.trim(), mfaRequired: dto.mfaRequired ?? false, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } },
        include: ROLE_INCLUDE,
      });
      await this.record(transaction, actor, 'ROLE_CREATED', role.id, role.code, traceId);
      return this.serialize(role);
    });
  }

  copy(actor: AdminUserActor, roleId: string, dto: CopyAdminRoleDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, { action: 'ROLE_COPIED', permission: 'account:roles:create', payload: { roleId, dto }, traceId, key }, async (transaction, granted) => {
      const template = await this.role(transaction, roleId, organizationId);
      await this.resolvePermissions(transaction, template.permissions.map((entry) => entry.permission.code), granted);
      const role = await transaction.role.create({
        data: { organizationId, code: dto.code, name: dto.name.trim(), mfaRequired: template.mfaRequired, permissions: { create: template.permissions.map((entry) => ({ permissionId: entry.permission.id })) } },
        include: ROLE_INCLUDE,
      });
      await this.record(transaction, actor, 'ROLE_CREATED', role.id, role.code, traceId);
      return this.serialize(role);
    });
  }

  update(actor: AdminUserActor, roleId: string, dto: UpdateAdminRoleDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, { action: 'ROLE_UPDATED', permission: 'account:roles:update', payload: { roleId, dto }, traceId, key }, async (transaction, granted) => {
      const existing = await this.role(transaction, roleId, organizationId);
      this.assertGranted(existing.permissions.map((entry) => entry.permission.code), granted);
      if (dto.mfaRequired !== undefined) {
        if (typeof dto.expectedMfaRequired !== 'boolean') this.fail('ADMIN_PERMISSION_BASELINE_REQUIRED', 400);
        if (dto.expectedMfaRequired !== existing.mfaRequired) this.fail('CONCURRENCY_CONFLICT', 409);
      }
      if (dto.permissionCodes !== undefined) {
        if (!Array.isArray(dto.expectedPermissionCodes)) this.fail('ADMIN_PERMISSION_BASELINE_REQUIRED', 400);
        const expected = new Set(dto.expectedPermissionCodes);
        const current = new Set(existing.permissions.map((entry) => entry.permission.code));
        if (expected.size !== current.size || [...current].some((code) => !expected.has(code))) this.fail('CONCURRENCY_CONFLICT', 409);
        const permissions = await this.resolvePermissions(transaction, dto.permissionCodes, granted);
        if (dto.permissionCodes.some((code) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(code))) {
          const supplierUsers = await transaction.userRole.count({ where: { roleId, user: { accountType: 'SUPPLIER' } } });
          const supplierPositions = await transaction.positionRole.count({ where: { roleId, position: { organization: { type: 'SUPPLIER' } } } });
          if (supplierUsers || supplierPositions) this.fail('FEATURE_PERMISSION_DENIED', 403);
        }
        await transaction.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length) await transaction.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permissionId: permission.id })) });
      }
      const role = await transaction.role.update({ where: { id: roleId }, data: { ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.mfaRequired === undefined ? {} : { mfaRequired: dto.mfaRequired }) }, include: ROLE_INCLUDE });
      if (dto.permissionCodes !== undefined || dto.mfaRequired !== undefined) {
        const userIds = await this.affectedUsers(transaction, roleId);
        await transaction.user.updateMany({ where: { id: { in: userIds } }, data: { securityVersion: { increment: 1 } } });
        await transaction.passwordReset.updateMany({ where: { consumedAt: null, userId: { in: userIds } }, data: { consumedAt: new Date() } });
      }
      await this.assertNotLocked(transaction, actor, granted);
      await this.record(transaction, actor, 'ROLE_UPDATED', roleId, existing.code, traceId);
      return this.serialize(role);
    });
  }

  remove(actor: AdminUserActor, roleId: string, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, { action: 'ROLE_DELETED', permission: 'account:roles:delete', payload: { roleId }, traceId, key }, async (transaction, granted) => {
      const existing = await this.role(transaction, roleId, organizationId);
      this.assertGranted(existing.permissions.map((entry) => entry.permission.code), granted);
      if (await transaction.userRole.count({ where: { roleId } }) || await transaction.positionRole.count({ where: { roleId } })) this.fail('ADMIN_ROLE_IN_USE', 409);
      await transaction.role.delete({ where: { id: roleId } });
      await this.record(transaction, actor, 'ROLE_DELETED', roleId, existing.code, traceId);
    });
  }

  async assignments(actor: AdminUserActor, userId: string) {
    const organizationId = this.scope(actor);
    await this.assertRead(actor);
    await this.assertUser(this.prisma, userId, organizationId);
    return this.userRoles(userId, organizationId, await effectiveRoleGrants(this.prisma, userId, organizationId));
  }

  assign(actor: AdminUserActor, userId: string, dto: AssignAdminRolesDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, { action: 'USER_ROLES_CHANGED', permission: 'account:roles:assign', payload: { userId, dto }, traceId, key }, async (transaction, granted) => {
      const user = await this.assertUser(transaction, userId, organizationId);
      const roleIds = [...new Set(dto.roleIds)];
      const roles = roleIds.length ? await transaction.role.findMany({ where: { id: { in: roleIds }, organizationId }, include: ROLE_INCLUDE }) : [];
      if (roles.length !== roleIds.length) this.fail('ADMIN_ROLE_NOT_FOUND', 404);
      await this.resolvePermissions(transaction, roles.flatMap((role) => role.permissions.map((entry) => entry.permission.code)), granted);
      const effective = await effectiveRoleGrants(transaction, userId);
      const existing = effective.filter((grant) => grant.organizationId === organizationId);
      if (existing.some((assignment) => assignment.role.organizationId === null && assignment.sources.some(({ kind }) => kind === 'DIRECT'))) this.fail('ADMIN_GLOBAL_ROLE_IMMUTABLE', 409);
      this.assertGranted(existing.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)), granted);
      if (user.accountType === 'SUPPLIER' && (roles.some((role) => role.permissions.some(({ permission }) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(permission.code)))
        || effective.some((grant) => grant.organizationId !== organizationId || grant.role.organizationId !== organizationId || grant.role.permissions.some(({ permission }) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(permission.code))))) this.fail('FEATURE_PERMISSION_DENIED', 403);
      await transaction.userRole.deleteMany({ where: { userId, organizationId } });
      if (roleIds.length) await transaction.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId, organizationId })) });
      await transaction.user.update({ where: { id: userId }, data: { securityVersion: { increment: 1 } } });
      await transaction.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
      await this.assertNotLocked(transaction, actor, granted);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'USER_ROLES_CHANGED', resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId } }, transaction);
      return this.userRoles(userId, organizationId, await effectiveRoleGrants(transaction, userId, organizationId));
    });
  }

  private mutate<Result>(actor: AdminUserActor, input: { action: string; permission: string; payload: unknown; traceId: string; key?: string }, work: (transaction: Transaction, granted: string[]) => Promise<Result>): Promise<Result> {
    return this.mutations.run({ ...input, key: input.key, actor, organizationId: this.scope(actor), duplicateCode: 'ADMIN_ROLE_DUPLICATE' }, work);
  }

  private scope(actor: AdminUserActor): string {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    return organizationId;
  }

  private async role(transaction: Transaction, roleId: string, organizationId: string) {
    const role = await transaction.role.findFirst({ where: { id: roleId, organizationId }, include: ROLE_INCLUDE });
    if (!role) this.fail('ADMIN_ROLE_NOT_FOUND', 404);
    return role;
  }

  private async assertUser(transaction: Transaction, userId: string, organizationId: string) {
    const user = await transaction.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, accountType: true } });
    if (!user) this.fail('ADMIN_USER_NOT_FOUND', 404);
    return user;
  }

  private async resolvePermissions(transaction: Transaction, codes: string[], granted: string[]) {
    const unique = [...new Set(codes)];
    if (!unique.length) return [];
    if (unique.some((code) => !ACTIVE_PERMISSION_CODES.includes(code))) this.fail('ADMIN_PERMISSION_NOT_FOUND', 400);
    const permissions = await transaction.permission.findMany({ where: { code: { in: unique } }, select: { id: true, code: true } });
    if (permissions.length !== unique.length) this.fail('ADMIN_PERMISSION_NOT_FOUND', 400);
    this.assertGranted(unique, granted);
    return permissions;
  }

  private assertGranted(codes: string[], granted: string[]) {
    if (codes.some((code) => !granted.includes(code))) this.fail('FEATURE_PERMISSION_DENIED', 403);
  }

  private async effectivePermissions(transaction: Transaction, actor: AdminUserActor): Promise<string[]> {
    const assignments = await effectiveRoleGrants(transaction, actor.id, this.scope(actor));
    return [...new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)))];
  }

  private async affectedUsers(transaction: Transaction, roleId: string): Promise<string[]> {
    // Composite FKs keep assignments in each user's home organization; query users once to deduplicate sources.
    const users = await transaction.user.findMany({
      where: { OR: [
        { userRoles: { some: { roleId } } },
        { positions: { some: { AND: [effectivePositionAssignmentWhere(), { position: { roles: { some: { roleId } } } }] } } },
      ] },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  private userRoles(userId: string, organizationId: string, grants: EffectiveRoleGrant[]) {
    const effectiveRoles = grants.map(({ role, sources }) => ({ ...this.serialize(role), sources }));
    const roles = grants.filter(({ sources }) => sources.some(({ kind }) => kind === 'DIRECT')).map(({ role }) => this.serialize(role));
    return { userId, organizationId, roles, effectiveRoles, permissions: [...new Set(effectiveRoles.flatMap((role) => role.permissions.map((permission) => permission.code)))].sort() };
  }

  private async assertNotLocked(transaction: Transaction, actor: AdminUserActor, before: string[]) {
    const after = await this.effectivePermissions(transaction, actor);
    if (ADMIN_PERMISSIONS.some((code) => before.includes(code) && !after.includes(code))) this.fail('ADMIN_SELF_LOCK_FORBIDDEN', 409);
  }

  private async assertRead(actor: AdminUserActor) {
    await assertAdminAccess(this.prisma, actor, this.scope(actor), 'account:roles:read');
  }

  private serialize(role: EffectiveRoleGrant['role']) {
    return { id: role.id, organizationId: role.organizationId, code: role.code, name: role.name, mfaRequired: role.mfaRequired, permissions: role.permissions.map(({ permission }) => ({ id: permission.id, code: permission.code, name: permission.name })).sort((first, second) => first.code.localeCompare(second.code)) };
  }

  private record(transaction: Transaction, actor: AdminUserActor, action: string, roleId: string, code: string, traceId: string) {
    return this.audit.record({ actorUserId: actor.id, organizationId: this.scope(actor), action, resourceType: 'Role', resourceId: roleId, outcome: 'SUCCESS', traceId, metadata: { targetRoleCode: code } }, transaction);
  }

  private fail(code: PlatformErrorCode, status: number): never {
    throw new HttpException({ code, message: PLATFORM_ERROR_MESSAGES[code] }, status);
  }
}
