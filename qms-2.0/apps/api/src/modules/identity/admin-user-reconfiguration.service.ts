import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AdministrativeReconfigurationKind as Kind, type AdministrativeReconfigurationDto, type AdministrativeReconfigurationQueryDto,
  type AdministrativeReconfigurationPageDto, type AdministrativeReconfigurationResultDto } from '../../common/security/administrative-reconfiguration.dto.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationReconfigurationService } from '../organization/organization-reconfiguration.service.js';
import { AdminUserLifecycleService } from './admin-user-lifecycle.service.js';

@Injectable()
export class AdminUserReconfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly organizations: OrganizationReconfigurationService, private readonly lifecycle: AdminUserLifecycleService) {}

  async listPending(actor: AdminActor, query: AdministrativeReconfigurationQueryDto): Promise<AdministrativeReconfigurationPageDto> {
    try {
      return await this.prisma.$transaction(async tx => {
        await this.organizations.authorize(tx, actor);
        const where = { configurationRequired: true, deletedAt: null, accountType: 'INTERNAL' as const,
          organizationId: { in: await this.organizations.internalOrganizationIds(tx) } };
        const rows = await tx.user.findMany({ where, orderBy: { id: 'asc' }, take: query.pageSize, skip: query.offset,
          select: { id: true, fullName: true, username: true, organizationId: true, securityVersion: true } });
        const items = [];
        for (const row of rows) {
          const scope = await this.organizations.scope(tx, row.organizationId, false, false);
          const missingScope = scope.status !== 'ACTIVE' || !!scope.deletedAt || scope.configurationRequired;
          items.push({ kind: Kind.USER, id: row.id, label: row.fullName || row.username, originalOrganizationId: row.organizationId,
            version: row.securityVersion, reason: missingScope ? 'ORGANIZATION_UNAVAILABLE' : 'APPOINTMENT_UNAVAILABLE',
            requiredConfiguration: missingScope ? ['targetOrganizationId'] : ['appointmentAfterReconfiguration'] });
        }
        return { items, total: await tx.user.count({ where }), pageSize: query.pageSize, offset: query.offset };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  restore(actor: AdminActor, id: string, dto: AdministrativeReconfigurationDto, traceId: string, key?: string): Promise<AdministrativeReconfigurationResultDto> {
    return this.mutations.run({ actor, organizationId: actor.organizationId, permission: 'organization:reconfigure', key, traceId,
      action: 'USER_RECONFIGURED', payload: { id, expectedVersion: dto.expectedVersion, targetOrganizationId: dto.targetOrganizationId }, isolationLevel: 'ReadCommitted' }, async tx => {
      if (!Number.isInteger(dto.expectedVersion) || dto.expectedVersion < 1 || dto.expectedVersion > 2147483646
        || dto.parentId !== undefined || dto.targetDepartmentId !== undefined) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) adminError('ADMIN_USER_NOT_FOUND', 404);
      if (!target.configurationRequired || target.securityVersion !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const source = await this.organizations.scope(tx, target.organizationId, false);
      const sourceActive = source.status === 'ACTIVE' && !source.deletedAt && !source.configurationRequired;
      if (!sourceActive && !dto.targetOrganizationId) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      const destination = await this.organizations.scope(tx, dto.targetOrganizationId ?? source.id, true);
      if (sourceActive && destination.id !== source.id) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      // The identity owner revokes credentials, old appointments and direct roles exactly once, before changing current scope.
      await this.lifecycle.revokeForReconfiguration(tx, actor, id, source.id);
      // Only this authorized, locked, version-checked pending command opens the historical-scope bridge.
      if (destination.id !== source.id) await tx.$executeRaw`SELECT set_config('qms.administrative_reconfiguration', 'approved', true)`;
      const changed = await tx.user.updateMany({ where: { id, deletedAt: null, configurationRequired: true, securityVersion: dto.expectedVersion + 1 },
        data: { organizationId: destination.id, configurationRequired: false, status: 'DISABLED' } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: 'USER_RECONFIGURED', resourceType: 'User', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { targetUserId: id, originalOrganizationId: source.id, organizationId: destination.id,
          resourceVersion: dto.expectedVersion + 1, status: 'DISABLED' } }, tx);
      return { kind: Kind.USER, id, originalOrganizationId: source.id, targetOrganizationId: destination.id, version: dto.expectedVersion + 1,
        status: 'DISABLED', configurationRequired: false };
    }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      await this.organizations.authorize(tx, actor, true);
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) adminError('ADMIN_USER_NOT_FOUND', 404);
      if (target.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
      await this.organizations.scope(tx, target.organizationId, false);
      if (actor.id === id) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
    });
  }

  // Server port: caller holds the pending organization lock; no HTTP payload can supply an actor or impact.
  async invalidateSessionsForOrganizationRestoration(tx: AdminTransaction, actor: AdminActor, organizationId: string): Promise<void> {
    await this.organizations.authorize(tx, actor, true);
    const scope = await this.organizations.scope(tx, organizationId, false);
    if (scope.deletedAt || !scope.configurationRequired) adminError('CONCURRENCY_CONFLICT', 409);
    await tx.$queryRaw`SELECT id FROM users WHERE organization_id = ${organizationId}::uuid ORDER BY id FOR UPDATE`;
    const users = await tx.user.findMany({ where: { organizationId, deletedAt: null }, select: { id: true } });
    if (!users.length) return;
    await tx.user.updateMany({ where: { id: { in: users.map(user => user.id) }, deletedAt: null }, data: { securityVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { userId: { in: users.map(user => user.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
