import { Injectable, Module } from '@nestjs/common';
import { Prisma, type User } from '../../generated/prisma/client.js';

// Server-authorized lifecycle callers only; authorization and transaction ownership stay with the caller.
@Injectable()
export class AdministrativeIdentityReadModel {
  // Compose inside the caller's query so eligibility bounds both its page and count.
  workflowEligibleUsers(organizationId: string): Prisma.Sql {
    return Prisma.sql`SELECT id, username, full_name FROM users
      WHERE organization_id = ${organizationId}::uuid AND status = 'ACTIVE' AND account_type = 'INTERNAL'
        AND deleted_at IS NULL AND NOT configuration_required`;
  }

  async responsibilityUser(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    return tx.user.findFirst({ where: { id: userId, organizationId }, select: { username: true, fullName: true } });
  }

  async lockResponsibilityUsers(tx: Prisma.TransactionClient, organizationId: string, userIds: string[]): Promise<{ id: string }[]> {
    if (userIds.length === 0) return [];
    return tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE organization_id = ${organizationId}::uuid
      AND id IN (${Prisma.join([...new Set(userIds)].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }

  async lifecycleUsers(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userIds?: string[],
  ): Promise<Pick<User, 'id' | 'securityVersion' | 'status' | 'configurationRequired'>[]> {
    if (userIds?.length === 0) return [];
    return tx.user.findMany({
      where: { organizationId, deletedAt: null, ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, securityVersion: true, status: true, configurationRequired: true },
      orderBy: { id: 'asc' },
    });
  }

  async lockLifecycleUsers(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users
      WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }
}

@Module({ providers: [AdministrativeIdentityReadModel], exports: [AdministrativeIdentityReadModel] })
export class AdministrativeIdentityReadModule {}
