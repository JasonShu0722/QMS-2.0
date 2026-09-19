import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { CreateAdminUserDto, AdminUserListQueryDto, UpdateAdminUserDto } from './dto/admin-user.dto.js';

export type AdminUserActor = { id: string; organizationId: string; accountType: 'INTERNAL' | 'SUPPLIER'; scopeOrganizationId?: string };
type Tx = Pick<PrismaService, 'user' | 'session' | 'auditEvent' | 'organization'>;

const USER_SELECT = {
  id: true, username: true, email: true, accountType: true, status: true, mfaEnabled: true,
  organizationId: true, createdAt: true, updatedAt: true,
  organization: { select: { id: true, code: true, name: true } },
} as const;

@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditLogService,
  ) {}

  async list(actor: AdminUserActor, query: AdminUserListQueryDto) {
    const organizationId = query.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId;
    this.assertScope(actor, organizationId);
    return this.prisma.user.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.accountType ? { accountType: query.accountType } : {}),
        ...(query.search ? { OR: [
          { username: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ] } : {}),
      },
      select: USER_SELECT,
      orderBy: [{ status: 'asc' }, { username: 'asc' }],
    });
  }

  async detail(actor: AdminUserActor, userId: string, organizationId = actor.scopeOrganizationId ?? actor.organizationId) {
    this.assertScope(actor, organizationId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: USER_SELECT });
    if (!user) this.notFound();
    return user;
  }

  async create(actor: AdminUserActor, dto: CreateAdminUserDto, traceId: string) {
    this.assertScope(actor, dto.organizationId);
    await this.assertOrganizationAccountType(dto.organizationId, dto.accountType);
    const passwordHash = await this.passwords.hash(dto.initialPassword);
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          organizationId: dto.organizationId,
          username: dto.username.trim(),
          email: dto.email ?? null,
          accountType: dto.accountType,
          passwordHash,
        },
        select: USER_SELECT,
      });
      await this.audit.record({
        actorUserId: actor.id, organizationId: dto.organizationId, action: 'USER_CREATED',
        resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId,
        metadata: { targetUserId: user.id },
      }, transaction);
      return user;
    });
  }

  async update(actor: AdminUserActor, userId: string, dto: UpdateAdminUserDto, organizationId: string, traceId: string) {
    this.assertScope(actor, organizationId);
    if (actor.id === userId && dto.status === 'DISABLED') {
      throw new HttpException({ code: 'ADMIN_SELF_DISABLE_FORBIDDEN', message: '不能停用当前管理员账号' }, 409);
    }
    const existing = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, organizationId: true, accountType: true } });
    if (!existing) this.notFound();
    const targetOrganizationId = dto.organizationId ?? existing.organizationId;
    this.assertScope(actor, targetOrganizationId);
    await this.assertOrganizationAccountType(targetOrganizationId, dto.accountType ?? existing.accountType);
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId },
        data: {
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.accountType ? { accountType: dto.accountType } : {}),
          ...(dto.organizationId ? { organizationId: dto.organizationId } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
        select: USER_SELECT,
      });
      if (dto.status === 'DISABLED') {
        await transaction.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record({
        actorUserId: actor.id, organizationId, action: 'USER_UPDATED', resourceType: 'User', resourceId: userId,
        outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId },
      }, transaction);
      return user;
    });
  }

  async resetPassword(actor: AdminUserActor, userId: string, newPassword: string, organizationId: string, traceId: string): Promise<void> {
    this.assertScope(actor, organizationId);
    const existing = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
    if (!existing) this.notFound();
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({
        actorUserId: actor.id, organizationId, action: 'PASSWORD_RESET', resourceType: 'User', resourceId: userId,
        outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId },
      }, transaction);
    });
  }

  private assertScope(actor: AdminUserActor, targetOrganizationId: string | undefined): void {
    if (!targetOrganizationId || actor.accountType === 'SUPPLIER' && targetOrganizationId !== actor.organizationId) {
      throw new HttpException({ code: 'ORGANIZATION_SCOPE_DENIED', message: '无权访问该组织范围' }, 403);
    }
  }

  private async assertOrganizationAccountType(organizationId: string, accountType: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (!organization || organization.type !== accountType) {
      throw new HttpException({ code: 'ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', message: '账号类型与组织类型不匹配' }, 400);
    }
  }

  private notFound(): never {
    throw new HttpException({ code: 'ADMIN_USER_NOT_FOUND', message: '用户不存在或不在当前组织范围' }, 404);
  }
}
