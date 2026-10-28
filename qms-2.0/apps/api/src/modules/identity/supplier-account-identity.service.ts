import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { adminError, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, assertRecentAuthentication } from '../../common/security/session-security.js';
import { assertSupplierAccountGovernance, assertSupplierAccountTarget, assignSupplierPortalRole } from '../authorization/supplier-account-authorization.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PasswordService } from './password.service.js';
import { TemporaryPasswordService } from './temporary-password.service.js';
import { CreateAdminUserDto } from './dto/admin-user.dto.js';

const accountSelect = { id: true, organizationId: true, username: true, email: true, status: true, securityVersion: true } as const;

@Injectable()
export class SupplierAccountIdentityService {
  constructor(private readonly passwords: PasswordService, private readonly temporary: TemporaryPasswordService, private readonly audit: AuditLogService) {}

  async create(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: { username: string; email?: string | null }, traceId: string, ownerOrganizationId?: string) {
    await assertRecentAuthentication(tx, actor);
    await assertSupplierAccountGovernance(tx, actor, organizationId, 'account:users:create', ownerOrganizationId);
    const password = randomBytes(18).toString('base64url');
    const dto = plainToInstance(CreateAdminUserDto, { username: input.username, email: input.email?.trim().toLowerCase() || null, organizationId, accountType: 'SUPPLIER', initialPassword: password });
    if (validateSync(dto).length) adminError('SUPPLIER_INPUT_INVALID', 400);
    const user = await tx.user.create({ data: { organizationId, username: dto.username, email: dto.email, accountType: 'SUPPLIER', passwordHash: await this.passwords.hash(password), mustChangePassword: true }, select: { ...accountSelect, credentialVersion: true } });
    await assignSupplierPortalRole(tx, organizationId, user.id);
    await this.temporary.store(tx, user.id, user.credentialVersion, password);
    await this.record(tx, actor, organizationId, user.id, 'USER_CREATED', traceId);
    return user;
  }

  async list(tx: AdminTransaction, actor: AdminActor, organizationId: string, ownerOrganizationId?: string) {
    await assertActiveAuthentication(tx, actor);
    await assertSupplierAccountGovernance(tx, actor, organizationId, 'account:users:read', ownerOrganizationId);
    const users = await tx.user.findMany({ where: { organizationId, accountType: 'SUPPLIER', deletedAt: null }, select: accountSelect, orderBy: { id: 'asc' } });
    for (const user of users) await assertSupplierAccountTarget(tx, actor, organizationId, user.id, 'account:users:read', ownerOrganizationId);
    const granted = await assertSupplierAccountGovernance(tx, actor, organizationId, 'account:users:read', ownerOrganizationId);
    return { items: users.sort((first, second) => first.username.localeCompare(second.username) || first.id.localeCompare(second.id)), canCreate: granted.includes('account:users:create'), canReset: granted.includes('account:users:reset'), canSetStatus: granted.includes('account:users:status') };
  }

  async projectTemporaryPassword(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, traceId: string, credentialVersion?: number, ownerOrganizationId?: string) {
    await assertRecentAuthentication(tx, actor);
    const user = await assertSupplierAccountTarget(tx, actor, organizationId, userId, 'account:users:reset', ownerOrganizationId);
    if (user.status !== 'ACTIVE') adminError('ADMIN_USER_NOT_FOUND', 404);
    const result = await this.temporary.project(tx, userId, credentialVersion);
    await this.record(tx, actor, organizationId, userId, 'TEMPORARY_PASSWORD_READ', traceId);
    return result;
  }

  async reset(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, traceId: string, ownerOrganizationId?: string) {
    await assertRecentAuthentication(tx, actor);
    const user = await assertSupplierAccountTarget(tx, actor, organizationId, userId, 'account:users:reset', ownerOrganizationId);
    if (user.status !== 'ACTIVE') adminError('ADMIN_USER_NOT_FOUND', 404);
    const result = await this.temporary.reset(tx, userId);
    await this.record(tx, actor, organizationId, userId, 'TEMPORARY_PASSWORD_RESET', traceId);
    return result;
  }

  async setStatus(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, input: { status: 'ACTIVE' | 'DISABLED'; expectedSecurityVersion: number }, traceId: string, ownerOrganizationId?: string) {
    await assertRecentAuthentication(tx, actor);
    const user = await assertSupplierAccountTarget(tx, actor, organizationId, userId, 'account:users:status', ownerOrganizationId);
    if (user.securityVersion !== input.expectedSecurityVersion) adminError('CONCURRENCY_CONFLICT', 409);
    const result = await tx.user.update({ where: { id: userId }, data: { status: input.status, securityVersion: { increment: 1 } }, select: accountSelect });
    if (input.status === 'DISABLED') {
      const now = new Date();
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      await tx.passwordChangeChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      await tx.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    }
    await this.record(tx, actor, organizationId, userId, 'USER_UPDATED', traceId);
    return result;
  }

  private record(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, action: string, traceId: string) {
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId, metadata: { targetUserId: userId } }, tx);
  }
}
