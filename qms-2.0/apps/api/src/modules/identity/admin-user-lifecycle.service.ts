import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { AdministrativeLifecycleRegistry } from '../../common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleEffect, AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { effectivePositionAssignmentWhere, roleGrantSources } from '../../common/security/effective-role-grants.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { DeleteAdminUserDto } from './admin-user-lifecycle.dto.js';
import { ESignatureService } from '../e-signature/e-signature.service.js';

@Injectable()
export class AdminUserLifecycleService implements AdministrativeLifecycleEffect {
  readonly module = 'identity' as const;
  constructor(private readonly registry: AdministrativeLifecycleRegistry, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly signatures: ESignatureService) {
    registry.register(this);
  }

  deleteUser(actor: AdminActor, userId: string, dto: DeleteAdminUserDto, organizationId: string, traceId: string, key?: string) {
    if (!Number.isInteger(dto.expectedSecurityVersion) || dto.expectedSecurityVersion < 1 || dto.expectedSecurityVersion > 2147483647) throw new BadRequestException('Invalid security version');
    return this.mutations.run({
      actor, organizationId: actor.organizationId, key, action: 'USER_FORCE_DELETED',
      payload: { userId, organizationId, expectedSecurityVersion: dto.expectedSecurityVersion },
      permission: ['account:users:read', 'account:users:delete'], traceId, isolationLevel: 'ReadCommitted',
    }, async tx => {
      return this.deleteIdentity(tx, actor, userId, dto, organizationId, traceId);
    }, async tx => {
      // AdminMutation locks actor first; share the organization/department lock before target locks, mapping deadlocks to 409.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      await assertRecentAuthentication(tx, actor);
      // Lifecycle authority comes from the surviving actor home, not the inactive historical tenant.
      await assertAdminAccess(tx, actor, actor.organizationId, ['account:users:read', 'account:users:delete']);
      if (!await hasPlatformAdministrator(tx, actor.id)) adminError('FEATURE_PERMISSION_DENIED', 403);
      const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
      if (!organization) adminError('ORGANIZATION_NOT_FOUND', 404);
      if (organization.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
      if (actor.id === userId) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid ORDER BY id FOR UPDATE`;
      // Replay authorizes the retained identity too, but never performs another deletion.
      if (!await tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } })) adminError('ADMIN_USER_NOT_FOUND', 404);
      await assertRecentAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, actor.organizationId, ['account:users:read', 'account:users:delete']);
      if (!await hasPlatformAdministrator(tx, actor.id)) adminError('FEATURE_PERMISSION_DENIED', 403);
    });
  }

  // Supplier profile owners authorize the exact binding before using this identity-owned port.
  async authorizeSupplierAccountDeletion(tx: AdminTransaction, actor: AdminActor, userId: string, organizationId: string): Promise<void> {
    if (actor.accountType !== "INTERNAL") adminError("ORGANIZATION_SCOPE_DENIED", 403);
    await assertRecentAuthentication(tx, actor);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
    await assertAdminAccess(tx, actor, actor.organizationId, ["account:users:read", "account:users:delete"]);
    if (!await hasPlatformAdministrator(tx, actor.id)) adminError("FEATURE_PERMISSION_DENIED", 403);
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (!organization) adminError("ORGANIZATION_NOT_FOUND", 404);
    if (organization.type !== "SUPPLIER") adminError("ORGANIZATION_SCOPE_DENIED", 403);
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    if (!await tx.user.findFirst({ where: { id: userId, organizationId, accountType: "SUPPLIER" }, select: { id: true } })) adminError("ADMIN_USER_NOT_FOUND", 404);
    await assertRecentAuthentication(tx, actor);
    await assertAdminAccess(tx, actor, actor.organizationId, ["account:users:read", "account:users:delete"]);
    if (!await hasPlatformAdministrator(tx, actor.id)) adminError("FEATURE_PERMISSION_DENIED", 403);
  }

  async deleteSupplierAccount(tx: AdminTransaction, actor: AdminActor, userId: string, organizationId: string, dto: DeleteAdminUserDto, traceId: string) {
    if (!Number.isInteger(dto.expectedSecurityVersion) || dto.expectedSecurityVersion < 1 || dto.expectedSecurityVersion > 2147483647) throw new BadRequestException("Invalid security version");
    await this.authorizeSupplierAccountDeletion(tx, actor, userId, organizationId);
    return this.deleteIdentity(tx, actor, userId, dto, organizationId, traceId);
  }

  private async deleteIdentity(tx: AdminTransaction, actor: AdminActor, userId: string, dto: DeleteAdminUserDto, organizationId: string, traceId: string) {
    const target = await tx.user.findFirst({ where: { id: userId, organizationId, deletedAt: null } });
    if (!target) adminError('ADMIN_USER_NOT_FOUND', 404);
    if (target.securityVersion !== dto.expectedSecurityVersion) adminError('CONCURRENCY_CONFLICT', 409);
    const impact: AdministrativeLifecycleImpact = {
      kind: 'USER', entityId: userId, organizationId, receiptOrganizationId: actor.organizationId,
      userIds: [userId], departmentIds: [], positionIds: [], organizationIds: [],
    };
    const authorizationSources = (await roleGrantSources(tx, userId)).map(grant => ({
      organizationId: grant.organizationId, roleId: grant.role.id, roleCode: grant.role.code,
      permissionCodes: grant.role.permissions.map(({ permission }) => permission.code),
      sourceKinds: [...new Set(grant.sources.map(source => source.kind))],
      assignmentIds: grant.sources.flatMap(source => source.kind === 'POSITION' ? [source.assignmentId] : []),
      positionIds: grant.sources.flatMap(source => source.kind === 'POSITION' ? [source.positionId] : []),
    }));
    const effects = await this.registry.apply(tx, actor, impact);
    const originalIdentity = JSON.stringify({
      id: target.id, organizationId: target.organizationId, username: target.username, email: target.email,
      fullName: target.fullName, phone: target.phone, accountType: target.accountType, status: target.status, authorizationSources,
    });
    await tx.$executeRaw`INSERT INTO administrative_deletions
      (id, scope_organization_id, entity_kind, entity_id, original_organization_id, actor_user_id, original_identity, impact)
      VALUES (${randomUUID()}::uuid, ${actor.organizationId}::uuid, 'USER', ${userId}::uuid,
        ${organizationId}::uuid, ${actor.id}::uuid, ${originalIdentity}::jsonb, ${JSON.stringify(impact)}::jsonb)`;
    await tx.user.update({ where: { id: userId }, data: {
      username: `deleted.${userId.replaceAll('-', '').toLowerCase()}`, email: null, emailVerifiedAt: null,
      passwordHash: randomBytes(48).toString('base64url'), mustChangePassword: false,
      status: 'DISABLED', deletedAt: new Date(), configurationRequired: false,
    } });
    await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: 'USER_FORCE_DELETED',
      resourceType: 'User', resourceId: userId, outcome: 'SUCCESS', traceId,
      metadata: { targetUserId: userId, organizationId, status: 'DELETED' } }, tx);
    return { userId, deleted: true as const, effects };
  }

  async apply(tx: AdminTransaction, actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    return this.invalidate(tx, actor, impact, impact.kind === 'USER' ? 'DELETE' : 'STRUCTURAL');
  }

  // Server-only port: restore has already authorized and locked the pending identity in its original scope.
  async revokeForReconfiguration(tx: AdminTransaction, actor: AdminActor, userId: string, organizationId: string) {
    return this.invalidate(tx, actor, { kind: 'USER', entityId: userId, organizationId, receiptOrganizationId: actor.organizationId,
      userIds: [userId], organizationIds: [], departmentIds: [], positionIds: [] }, 'RECONFIGURE');
  }

  private async invalidate(tx: AdminTransaction, actor: AdminActor, impact: AdministrativeLifecycleImpact, purpose: 'DELETE' | 'STRUCTURAL' | 'RECONFIGURE') {
    const ids = [...new Set(impact.userIds)].sort();
    if (!ids.length) return { module: this.module, changed: 0, pendingConfiguration: 0 };
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const users = await tx.user.findMany({ where: { id: { in: ids }, deletedAt: null }, orderBy: { id: 'asc' } });
    if (users.length !== ids.length || users.some(user => impact.kind === 'ORGANIZATION'
      ? !impact.organizationIds.includes(user.organizationId)
      : user.organizationId !== impact.organizationId)
      || (impact.kind === 'USER' && (ids.length !== 1 || ids[0] !== impact.entityId))) adminError('CONCURRENCY_CONFLICT', 409);
    const now = new Date();
    let pendingConfiguration = 0;
    for (const user of users) {
      const ended = await tx.userPosition.updateMany({ where: {
        userId: user.id, OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        ...(impact.kind === 'USER' ? {} : impact.kind === 'ORGANIZATION'
          ? { organizationId: { in: impact.organizationIds } }
          : { organizationId: impact.organizationId, positionId: { in: impact.positionIds } }),
      }, data: { endedAt: now } });
      const missingOrganization = impact.kind === 'ORGANIZATION' && impact.organizationIds.includes(user.organizationId);
      const missingDepartment = impact.kind === 'DEPARTMENT' && (impact.unavailableUserIds !== undefined
        ? impact.unavailableUserIds.includes(user.id)
        : ended.count > 0 && !await tx.userPosition.count({ where: { userId: user.id, ...effectivePositionAssignmentWhere(now) } }));
      const pending = missingOrganization || missingDepartment;
      if (pending) pendingConfiguration++;
      await tx.user.update({ where: { id: user.id }, data: {
        securityVersion: { increment: 1 }, credentialVersion: { increment: 1 },
        ...(purpose === 'DELETE' ? { mfaEnabled: false, mfaFailures: 0, mfaBlockedUntil: null } : {}),
        ...(user.mustChangePassword ? { passwordHash: randomBytes(48).toString('base64url') } : {}),
        ...(pending ? { configurationRequired: true, status: 'DISABLED' } : {}),
      } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.passwordReset.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.passwordChangeChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.mfaRecoveryCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.emailVerification.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.recoveryDelivery.updateMany({ where: { verification: { userId: user.id }, OR: [{ encryptedPayload: { not: null } }, { status: { in: ['PENDING', 'PROCESSING'] } }] }, data: { status: 'CANCELLED', encryptedPayload: null, claimId: null, processingAt: null } });
      // Only permanent deletion destroys the enrolled factor; surviving identities keep it and their lockout.
      if (purpose === 'DELETE') await tx.mfaCredential.deleteMany({ where: { userId: user.id } });
      else await tx.mfaCredential.updateMany({ where: { userId: user.id }, data: { pendingSecret: null, pendingExpiresAt: null } });
      await tx.userTemporaryPassword.deleteMany({ where: { userId: user.id } });
      if (impact.kind === 'USER') await tx.userRole.deleteMany({ where: { userId: user.id } });
      // Revoke future signing capability, never rewrite immutable approval_signatures or file objects.
      await this.signatures.revokeForAdministrativeLifecycle(tx, actor, [user.id], now);
    }
    return { module: this.module, changed: users.length, pendingConfiguration };
  }
}
