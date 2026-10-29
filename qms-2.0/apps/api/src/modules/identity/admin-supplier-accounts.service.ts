import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { AdminUserLifecycleService } from './admin-user-lifecycle.service.js';
import type { DeleteAdminUserDto } from './admin-user-lifecycle.dto.js';
import type { AdminSupplierAccountsQueryDto } from './admin-supplier-accounts.dto.js';

@Injectable()
export class AdminSupplierAccountsService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly lifecycle: AdminUserLifecycleService) {}
  private async authorize(tx: AdminTransaction, actor: AdminActor) {
    await assertActiveAuthentication(tx, actor);
    if (actor.accountType !== 'INTERNAL' || !await hasPlatformAdministrator(tx, actor.id)) adminError('FEATURE_PERMISSION_DENIED', 403);
    await assertAdminAccess(tx, actor, actor.organizationId, ['account:users:read', 'account:users:delete']);
  }
  list(actor: AdminActor, query: AdminSupplierAccountsQueryDto) {
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, actor);
      const where = { accountType: 'SUPPLIER' as const, deletedAt: null, organization: { type: 'SUPPLIER' as const },
        ...(query.search ? { OR: [{ username: { contains: query.search, mode: 'insensitive' as const } }, { email: { contains: query.search, mode: 'insensitive' as const } },
          { organization: { name: { contains: query.search, mode: 'insensitive' as const }, type: 'SUPPLIER' as const } }] } : {}) };
      const items = await tx.user.findMany({ where, select: { id: true, username: true, email: true, accountType: true, status: true,
        securityVersion: true, organizationId: true,
        organization: { select: { id: true, code: true, name: true } } }, orderBy: [{ username: 'asc' }, { id: 'asc' }], take: query.pageSize, skip: query.offset });
      const total = await tx.user.count({ where });
      await this.authorize(tx, actor);
      return { items, total, pageSize: query.pageSize, offset: query.offset };
    }, { isolationLevel: 'ReadCommitted' });
  }
  delete(actor: AdminActor, userId: string, organizationId: string, input: DeleteAdminUserDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId: actor.organizationId, key, traceId, permission: ['account:users:read', 'account:users:delete'],
      action: 'SUPPLIER_ACCOUNT_FORCE_DELETED', payload: { userId, organizationId, expectedSecurityVersion: input.expectedSecurityVersion }, isolationLevel: 'ReadCommitted' },
    tx => this.lifecycle.deleteSupplierAccount(tx, actor, userId, organizationId, input, traceId),
    tx => this.lifecycle.authorizeSupplierAccountDeletion(tx, actor, userId, organizationId));
  }
}
