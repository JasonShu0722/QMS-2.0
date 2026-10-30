import { Injectable, Module } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { effectiveRoleGrants, hasPlatformAdministrator, roleGrantSources } from '../../common/security/effective-role-grants.js';
import { effectiveMfa } from '../../common/security/mfa-policy.js';
import { isGovernancePermission } from '../../common/security/session-security.js';

@Injectable()
export class LegacyAuthorizationIdentityService {
  sourceMemberships(query: { userId?: string; positionId?: string }) {
    return Prisma.sql`SELECT a.id, a.user_id, a.organization_id, a.position_id, a.started_at, a.ended_at,
      u.organization_id AS user_organization_id, u.username, u.full_name, u.status::text AS user_status,
      (u.status = 'ACTIVE' AND u.deleted_at IS NULL AND NOT u.configuration_required AND u.account_type = 'INTERNAL') AS user_available
      FROM user_positions a JOIN users u ON u.id = a.user_id
      WHERE ${query.userId ? Prisma.sql`a.user_id = ${query.userId}::uuid` : Prisma.sql`a.position_id = ${query.positionId}::uuid`}`;
  }

  async subject(tx: AdminTransaction, userId: string) {
    return tx.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, username: true, fullName: true, status: true, accountType: true, deletedAt: true, configurationRequired: true } });
  }

  async snapshot(tx: AdminTransaction, userIds: string[], organizationId: string) {
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, organizationId: true, username: true, fullName: true, organization: { select: { id: true, status: true, type: true } }, status: true, accountType: true, deletedAt: true, configurationRequired: true, securityVersion: true, credentialVersion: true, mfaEnabled: true, mfaPreference: true, mfaRequirementOverride: true }, orderBy: { id: 'asc' } });
    const result = [];
    for (const user of users) {
      const globalGrants = await effectiveRoleGrants(tx, user.id);
      const effectiveMfaRequired = effectiveMfa(globalGrants.some(grant => grant.role.permissions.some(({ permission }) => isGovernancePermission(permission.code))), user.mfaPreference, globalGrants.some(grant => grant.role.mfaRequired), user.mfaEnabled, user.mfaRequirementOverride);
      result.push({ ...user, grants: globalGrants.filter(grant => grant.organizationId === organizationId), effectiveMfaRequired, rawGrants: await roleGrantSources(tx, user.id), platformAdministrator: await hasPlatformAdministrator(tx, user.id) });
    }
    return result;
  }

  async lock(tx: AdminTransaction, userIds: string[]) {
    if (userIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join([...new Set(userIds)].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  async hasAnyPlatformAdministrator(tx: AdminTransaction) {
    const candidates = await tx.user.findMany({ where: { status: 'ACTIVE', accountType: 'INTERNAL', OR: [
      { userRoles: { some: { role: { archivedAt: null, permissions: { some: { permission: { code: 'platform:admin' } } } } } } },
      { positions: { some: { position: { roles: { some: { role: { archivedAt: null, permissions: { some: { permission: { code: 'platform:admin' } } } } } } } } } },
    ] }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const candidate of candidates) if (await hasPlatformAdministrator(tx, candidate.id)) return true;
    return false;
  }

  async revoke(tx: AdminTransaction, userIds: string[]) {
    if (!userIds.length) return;
    const now = new Date();
    const where = { userId: { in: userIds }, consumedAt: null };
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { securityVersion: { increment: 1 }, credentialVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: now } });
    await tx.passwordReset.updateMany({ where, data: { consumedAt: now } });
    await tx.passwordChangeChallenge.updateMany({ where, data: { consumedAt: now } });
    await tx.mfaChallenge.updateMany({ where, data: { consumedAt: now } });
    await tx.emailVerification.updateMany({ where, data: { consumedAt: now } });
    await tx.recoveryDelivery.updateMany({ where: { verification: { userId: { in: userIds } }, OR: [{ encryptedPayload: { not: null } }, { status: { in: ['PENDING', 'PROCESSING'] } }] }, data: { status: 'CANCELLED', encryptedPayload: null, claimId: null, processingAt: null } });
    await tx.mfaCredential.updateMany({ where: { userId: { in: userIds } }, data: { pendingSecret: null, pendingExpiresAt: null } });
    await tx.userTemporaryPassword.deleteMany({ where: { userId: { in: userIds } } });
  }
}

@Module({ providers: [LegacyAuthorizationIdentityService], exports: [LegacyAuthorizationIdentityService] })
export class LegacyAuthorizationIdentityModule {}
