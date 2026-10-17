import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, assertRecentAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assertSupplierAccountGovernance, assertSupplierAccountTarget } from '../authorization/supplier-account-authorization.js';
import { SupplierAccountIdentityService } from '../identity/supplier-account-identity.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import type { CreateSupplierAccountDto, SetSupplierAccountStatusDto } from './supplier-account.dto.js';

@Injectable()
export class SupplierAccountService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly identities: SupplierAccountIdentityService, private readonly organizations: OrganizationService, private readonly audit: AuditLogService) {}

  private scope(actor: AdminActor) {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async profile(tx: AdminTransaction, actor: AdminActor, profileId: string, lock = false) {
    const ownerOrganizationId = this.scope(actor);
    if (lock) await tx.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${profileId}::uuid AND owner_organization_id = ${ownerOrganizationId}::uuid FOR UPDATE`;
    const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: profileId, ownerOrganizationId } });
    if (!profile) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return profile;
  }

  async list(actor: AdminActor, profileId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      let granted = await assertAdminAccess(tx, actor, this.scope(actor), 'supplier-quality:profiles:read');
      const profile = await this.profile(tx, actor, profileId);
      if (!profile.supplierOrganizationId) return { items: [], canCreate: granted.includes('account:users:create') && granted.includes('supplier-quality:profiles:write'), canReset: false, canSetStatus: false };
      const result = await this.identities.list(tx, actor, profile.supplierOrganizationId);
      granted = await assertAdminAccess(tx, actor, this.scope(actor), 'supplier-quality:profiles:read');
      return { ...result, canCreate: result.canCreate && granted.includes('account:users:create') && granted.includes('supplier-quality:profiles:write'), canReset: result.canReset && granted.includes('supplier-quality:profiles:write'), canSetStatus: result.canSetStatus && granted.includes('supplier-quality:profiles:write') };
    });
  }

  async create(actor: AdminActor, profileId: string, dto: CreateSupplierAccountDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const result = await this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ACCOUNT_CREATED', payload: { profileId, dto }, permission: ['supplier-quality:profiles:write', 'account:users:create'], duplicateCode: 'ADMIN_USER_DUPLICATE', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const profile = await this.profile(tx, actor, profileId, true);
      let supplierOrganizationId = profile.supplierOrganizationId;
      if (!supplierOrganizationId) {
        if (dto.supplierOrganizationId) {
          await assertSupplierAccountGovernance(tx, actor, dto.supplierOrganizationId, 'account:users:create');
          supplierOrganizationId = dto.supplierOrganizationId;
        } else {
          supplierOrganizationId = (await this.organizations.createSupplierBoundary(tx, actor, organizationId, profile.displayName, traceId)).id;
        }
        const bound = await tx.supplierBusinessProfile.updateMany({ where: { id: profileId, ownerOrganizationId: organizationId, supplierOrganizationId: null, version: profile.version }, data: { supplierOrganizationId, version: { increment: 1 } } });
        if (bound.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
        await this.audit.record({ actorUserId: actor.id, organizationId, action: 'SUPPLIER_COLLABORATION_ENABLED', resourceType: 'SupplierBusinessProfile', resourceId: profileId, outcome: 'SUCCESS', traceId, metadata: { supplierOrganizationId } }, tx);
      }
      return this.identities.create(tx, actor, supplierOrganizationId, dto, traceId);
    }, async (tx) => {
      const profile = await this.profile(tx, actor, profileId, true);
      if (profile.supplierOrganizationId) {
        if (dto.supplierOrganizationId && dto.supplierOrganizationId !== profile.supplierOrganizationId) adminError('CONCURRENCY_CONFLICT', 409);
        await assertSupplierAccountGovernance(tx, actor, profile.supplierOrganizationId, 'account:users:create');
      } else if (dto.supplierOrganizationId) await assertSupplierAccountGovernance(tx, actor, dto.supplierOrganizationId, 'account:users:create');
    });
    return this.prisma.$transaction(async (tx) => {
      await assertRecentAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, ['supplier-quality:profiles:write', 'account:users:create']);
      const profile = await this.profile(tx, actor, profileId);
      if (profile.supplierOrganizationId !== result.organizationId) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
      const granted = await assertSupplierAccountGovernance(tx, actor, result.organizationId, 'account:users:create');
      const { credentialVersion, ...account } = result;
      const temporaryPassword = granted.includes('account:users:reset')
        ? await this.identities.projectTemporaryPassword(tx, actor, result.organizationId, result.id, traceId, credentialVersion)
        : { userId: result.id, status: 'UNAVAILABLE' as const };
      return { ...account, temporaryPassword };
    });
  }

  async temporaryPassword(actor: AdminActor, profileId: string, userId: string, traceId: string, expectedVersion?: number) {
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, this.scope(actor), 'supplier-quality:profiles:write');
      const profile = await this.profile(tx, actor, profileId);
      if (!profile.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      return this.identities.projectTemporaryPassword(tx, actor, profile.supplierOrganizationId, userId, traceId, expectedVersion);
    });
  }

  async reset(actor: AdminActor, profileId: string, userId: string, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const result = await this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ACCOUNT_PASSWORD_RESET', payload: { profileId, userId }, permission: 'supplier-quality:profiles:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const profile = await this.profile(tx, actor, profileId);
      if (!profile.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      return this.identities.reset(tx, actor, profile.supplierOrganizationId, userId, traceId);
    }, (tx) => this.authorizeAccount(tx, actor, profileId, userId, 'account:users:reset'));
    return this.temporaryPassword(actor, profileId, userId, traceId, result.credentialVersion);
  }

  setStatus(actor: AdminActor, profileId: string, userId: string, dto: SetSupplierAccountStatusDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ACCOUNT_STATUS_UPDATED', payload: { profileId, userId, dto }, permission: 'supplier-quality:profiles:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const profile = await this.profile(tx, actor, profileId);
      if (!profile.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      return this.identities.setStatus(tx, actor, profile.supplierOrganizationId, userId, dto, traceId);
    }, (tx) => this.authorizeAccount(tx, actor, profileId, userId, 'account:users:status'));
  }

  private async authorizeAccount(tx: AdminTransaction, actor: AdminActor, profileId: string, userId: string, permission: string) {
    const profile = await this.profile(tx, actor, profileId);
    if (!profile.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
    await assertSupplierAccountTarget(tx, actor, profile.supplierOrganizationId, userId, permission);
  }
}
