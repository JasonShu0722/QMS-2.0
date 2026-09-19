import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../../common/contracts/platform-error.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { AdminUserActor } from '../identity/admin-user.service.js';
import type { AssignAdminRolesDto, CopyAdminRoleDto, CreateAdminRoleDto, UpdateAdminRoleDto } from './admin-role.dto.js';

type Transaction = Prisma.TransactionClient;
const ROLE_INCLUDE = { permissions: { include: { permission: true } } } as const;
type RoleWithPermissions = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;
const MANAGEMENT_PERMISSIONS = ['account:users:read', 'account:users:manage', 'account:roles:read', 'account:roles:manage'];

@Injectable()
export class AdminRoleService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async permissions(actor: AdminUserActor) {
    await this.assertRead(actor);
    return this.prisma.permission.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
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

  create(actor: AdminUserActor, dto: CreateAdminRoleDto, traceId: string) {
    const organizationId = this.scope(actor);
    if (dto.organizationId !== organizationId) this.fail('ORGANIZATION_SCOPE_DENIED', 403);
    return this.mutate(actor, async (transaction, granted) => {
      const permissions = await this.resolvePermissions(transaction, dto.permissionCodes, granted);
      const role = await transaction.role.create({
        data: { organizationId, code: dto.code, name: dto.name.trim(), permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } },
        include: ROLE_INCLUDE,
      });
      await this.record(transaction, actor, 'ROLE_CREATED', role.id, role.code, traceId);
      return this.serialize(role);
    });
  }

  copy(actor: AdminUserActor, roleId: string, dto: CopyAdminRoleDto, traceId: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, async (transaction, granted) => {
      const template = await this.role(transaction, roleId, organizationId);
      this.assertGranted(template.permissions.map((entry) => entry.permission.code), granted);
      const role = await transaction.role.create({
        data: { organizationId, code: dto.code, name: dto.name.trim(), permissions: { create: template.permissions.map((entry) => ({ permissionId: entry.permission.id })) } },
        include: ROLE_INCLUDE,
      });
      await this.record(transaction, actor, 'ROLE_CREATED', role.id, role.code, traceId);
      return this.serialize(role);
    });
  }

  update(actor: AdminUserActor, roleId: string, dto: UpdateAdminRoleDto, traceId: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, async (transaction, granted) => {
      const existing = await this.role(transaction, roleId, organizationId);
      this.assertGranted(existing.permissions.map((entry) => entry.permission.code), granted);
      if (dto.permissionCodes !== undefined) {
        const permissions = await this.resolvePermissions(transaction, dto.permissionCodes, granted);
        await transaction.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length) await transaction.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permissionId: permission.id })) });
      }
      const role = await transaction.role.update({ where: { id: roleId }, data: dto.name === undefined ? {} : { name: dto.name.trim() }, include: ROLE_INCLUDE });
      await this.assertNotLocked(transaction, actor, granted);
      await this.record(transaction, actor, 'ROLE_UPDATED', roleId, existing.code, traceId);
      return this.serialize(role);
    });
  }

  remove(actor: AdminUserActor, roleId: string, traceId: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, async (transaction, granted) => {
      const existing = await this.role(transaction, roleId, organizationId);
      this.assertGranted(existing.permissions.map((entry) => entry.permission.code), granted);
      if (await transaction.userRole.count({ where: { roleId } })) this.fail('ADMIN_ROLE_IN_USE', 409);
      await transaction.role.delete({ where: { id: roleId } });
      await this.record(transaction, actor, 'ROLE_DELETED', roleId, existing.code, traceId);
    });
  }

  async assignments(actor: AdminUserActor, userId: string) {
    const organizationId = this.scope(actor);
    await this.assertRead(actor);
    await this.assertUser(this.prisma, userId, organizationId);
    const assignments = await this.prisma.userRole.findMany({ where: { userId, organizationId }, include: { role: { include: ROLE_INCLUDE } } });
    const roles = assignments.map((assignment) => this.serialize(assignment.role));
    return { userId, organizationId, roles, permissions: [...new Set(roles.flatMap((role) => role.permissions.map((permission) => permission.code)))].sort() };
  }

  assign(actor: AdminUserActor, userId: string, dto: AssignAdminRolesDto, traceId: string) {
    const organizationId = this.scope(actor);
    return this.mutate(actor, async (transaction, granted) => {
      await this.assertUser(transaction, userId, organizationId);
      const roleIds = [...new Set(dto.roleIds)];
      const roles = roleIds.length ? await transaction.role.findMany({ where: { id: { in: roleIds }, organizationId }, include: ROLE_INCLUDE }) : [];
      if (roles.length !== roleIds.length) this.fail('ADMIN_ROLE_NOT_FOUND', 404);
      this.assertGranted(roles.flatMap((role) => role.permissions.map((entry) => entry.permission.code)), granted);
      const existing = await transaction.userRole.findMany({ where: { userId, organizationId }, include: { role: { include: ROLE_INCLUDE } } });
      this.assertGranted(existing.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)), granted);
      await transaction.userRole.deleteMany({ where: { userId, organizationId } });
      if (roleIds.length) await transaction.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId, organizationId })) });
      await this.assertNotLocked(transaction, actor, granted);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'USER_ROLES_CHANGED', resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId } }, transaction);
      const result = roles.map((role) => this.serialize(role));
      return { userId, organizationId, roles: result, permissions: [...new Set(result.flatMap((role) => role.permissions.map((permission) => permission.code)))].sort() };
    });
  }

  private async mutate<Result>(actor: AdminUserActor, work: (transaction: Transaction, granted: string[]) => Promise<Result>): Promise<Result> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const granted = await this.effectivePermissions(transaction, actor);
        if (!granted.includes('account:roles:manage')) this.fail('FEATURE_PERMISSION_DENIED', 403);
        return work(transaction, granted);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2034') this.fail('CONCURRENCY_CONFLICT', 409);
      if (code === 'P2002') this.fail('ADMIN_ROLE_DUPLICATE', 409);
      throw error;
    }
  }

  private scope(actor: AdminUserActor): string {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (actor.accountType === 'SUPPLIER' && organizationId !== actor.organizationId) this.fail('ORGANIZATION_SCOPE_DENIED', 403);
    return organizationId;
  }

  private async role(transaction: Transaction, roleId: string, organizationId: string) {
    const role = await transaction.role.findFirst({ where: { id: roleId, organizationId }, include: ROLE_INCLUDE });
    if (!role) this.fail('ADMIN_ROLE_NOT_FOUND', 404);
    return role;
  }

  private async assertUser(transaction: Transaction, userId: string, organizationId: string) {
    const user = await transaction.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
    if (!user) this.fail('ADMIN_USER_NOT_FOUND', 404);
  }

  private async resolvePermissions(transaction: Transaction, codes: string[], granted: string[]) {
    const unique = [...new Set(codes)];
    if (!unique.length) return [];
    const permissions = await transaction.permission.findMany({ where: { code: { in: unique } }, select: { id: true, code: true } });
    if (permissions.length !== unique.length) this.fail('ADMIN_PERMISSION_NOT_FOUND', 400);
    this.assertGranted(unique, granted);
    return permissions;
  }

  private assertGranted(codes: string[], granted: string[]) {
    if (codes.some((code) => !granted.includes(code))) this.fail('FEATURE_PERMISSION_DENIED', 403);
  }

  private async effectivePermissions(transaction: Transaction, actor: AdminUserActor): Promise<string[]> {
    const assignments = await transaction.userRole.findMany({ where: { userId: actor.id, organizationId: this.scope(actor) }, include: { role: { include: ROLE_INCLUDE } } });
    return [...new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)))];
  }

  private async assertNotLocked(transaction: Transaction, actor: AdminUserActor, before: string[]) {
    const after = await this.effectivePermissions(transaction, actor);
    if (MANAGEMENT_PERMISSIONS.some((code) => before.includes(code) && !after.includes(code))) this.fail('ADMIN_SELF_LOCK_FORBIDDEN', 409);
  }

  private async assertRead(actor: AdminUserActor) {
    const granted = await this.effectivePermissions(this.prisma, actor);
    if (!granted.includes('account:roles:read')) this.fail('FEATURE_PERMISSION_DENIED', 403);
  }

  private serialize(role: RoleWithPermissions) {
    return { id: role.id, organizationId: role.organizationId, code: role.code, name: role.name, permissions: role.permissions.map(({ permission }) => ({ id: permission.id, code: permission.code, name: permission.name })).sort((first, second) => first.code.localeCompare(second.code)) };
  }

  private record(transaction: Transaction, actor: AdminUserActor, action: string, roleId: string, code: string, traceId: string) {
    return this.audit.record({ actorUserId: actor.id, organizationId: this.scope(actor), action, resourceType: 'Role', resourceId: roleId, outcome: 'SUCCESS', traceId, metadata: { targetRoleCode: code } }, transaction);
  }

  private fail(code: PlatformErrorCode, status: number): never {
    throw new HttpException({ code, message: PLATFORM_ERROR_MESSAGES[code] }, status);
  }
}
