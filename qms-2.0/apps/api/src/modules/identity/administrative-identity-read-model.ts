import { Injectable, Module } from '@nestjs/common';
import { Prisma, type User } from '../../generated/prisma/client.js';

// Server-authorized lifecycle callers only; authorization and transaction ownership stay with the caller.
@Injectable()
export class AdministrativeIdentityReadModel {
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
