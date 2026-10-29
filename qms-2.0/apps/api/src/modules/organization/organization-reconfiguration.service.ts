import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, assertRecentAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { AdministrativeReconfigurationKind as Kind, type AdministrativeReconfigurationDto, type AdministrativeReconfigurationQueryDto,
  type AdministrativeReconfigurationPageDto, type AdministrativeReconfigurationResultDto, type StructureReconfigurationKind } from '../../common/security/administrative-reconfiguration.dto.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

type RestorationIdentityPort = (tx: AdminTransaction, actor: AdminActor, organizationId: string) => Promise<void>;
const permission = 'organization:reconfigure';

@Injectable()
export class OrganizationReconfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  // This platform-only directory deliberately authorizes the surviving home, never the deleted scope.
  async authorize(tx: AdminTransaction, actor: AdminActor, recent = false) {
    const authentication = recent ? await assertRecentAuthentication(tx, actor) : await assertActiveAuthentication(tx, actor);
    const home = await tx.organization.findUnique({ where: { id: actor.organizationId } });
    if (actor.accountType !== 'INTERNAL' || authentication.user.accountType !== 'INTERNAL'
      || authentication.user.organizationId !== actor.organizationId || authentication.user.deletedAt || authentication.user.configurationRequired
      || !home || home.type !== 'INTERNAL' || home.deletedAt || home.configurationRequired
      || !await hasPlatformAdministrator(tx, actor.id)) adminError('FEATURE_PERMISSION_DENIED', 403);
    await assertAdminAccess(tx, actor, actor.organizationId, permission);
  }

  async internalOrganizationIds(tx: AdminTransaction) {
    return (await tx.organization.findMany({ where: { type: 'INTERNAL' }, select: { id: true } })).map(row => row.id);
  }

  async scope(tx: AdminTransaction, id: string, active: boolean, lock = true) {
    if (lock) await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${id}::uuid FOR UPDATE`;
    const organization = await tx.organization.findUnique({ where: { id } });
    if (!organization) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (organization.type !== 'INTERNAL') adminError('STRUCTURE_REFERENCE_INVALID', 400);
    if (active && (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired)) adminError('STRUCTURE_REFERENCE_INVALID', 400);
    return organization;
  }

  async listPending(actor: AdminActor, query: AdministrativeReconfigurationQueryDto): Promise<AdministrativeReconfigurationPageDto> {
    try {
      return await this.prisma.$transaction(async tx => {
        await this.authorize(tx, actor);
        const common = { configurationRequired: true, deletedAt: null };
        const page = { orderBy: { id: 'asc' as const }, take: query.pageSize, skip: query.offset };
        if (query.kind === Kind.ORGANIZATION) {
          const where = { ...common, type: 'INTERNAL' as const };
          const rows = await tx.organization.findMany({ where, ...page, select: { id: true, name: true, version: true } });
          return { items: rows.map(row => ({ kind: Kind.ORGANIZATION, id: row.id, label: row.name, originalOrganizationId: row.id,
            version: row.version, reason: 'PARENT_ORGANIZATION_UNAVAILABLE', requiredConfiguration: ['parentId'] })), total: await tx.organization.count({ where }), pageSize: query.pageSize, offset: query.offset };
        }
        const where = { ...common, organization: { type: 'INTERNAL' as const } };
        if (query.kind === Kind.DEPARTMENT) {
          const rows = await tx.department.findMany({ where, ...page, select: { id: true, name: true, version: true, organizationId: true,
            organization: { select: { status: true, deletedAt: true, configurationRequired: true } } } });
          return { items: rows.map(row => ({ kind: Kind.DEPARTMENT, id: row.id, label: row.name, originalOrganizationId: row.organizationId,
            version: row.version, reason: row.organization.deletedAt ? 'ORGANIZATION_DELETED_REPLACEMENT_REQUIRED' : 'PARENT_DEPARTMENT_UNAVAILABLE',
            requiredConfiguration: row.organization.deletedAt ? ['targetOrganizationId', 'targetDepartmentId'] : ['parentId'] })), total: await tx.department.count({ where }), pageSize: query.pageSize, offset: query.offset };
        }
        const rows = await tx.position.findMany({ where, ...page, select: { id: true, name: true, version: true, organizationId: true,
          organization: { select: { deletedAt: true } } } });
        return { items: rows.map(row => ({ kind: Kind.POSITION, id: row.id, label: row.name, originalOrganizationId: row.organizationId,
          version: row.version, reason: row.organization.deletedAt ? 'ORGANIZATION_DELETED_REPLACEMENT_REQUIRED' : 'DEPARTMENT_UNAVAILABLE',
          requiredConfiguration: row.organization.deletedAt ? ['targetOrganizationId', 'targetDepartmentId'] : ['targetDepartmentId'] })), total: await tx.position.count({ where }), pageSize: query.pageSize, offset: query.offset };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  restore(actor: AdminActor, kind: StructureReconfigurationKind, id: string, dto: AdministrativeReconfigurationDto,
    traceId: string, key: string | undefined, invalidateSessions: RestorationIdentityPort): Promise<AdministrativeReconfigurationResultDto> {
    return this.mutations.run({ actor, organizationId: actor.organizationId, permission, key, traceId,
      action: `${kind}_RECONFIGURED`, payload: { kind, id, expectedVersion: dto.expectedVersion, parentId: dto.parentId,
        targetOrganizationId: dto.targetOrganizationId, targetDepartmentId: dto.targetDepartmentId }, isolationLevel: 'ReadCommitted' }, async tx => {
      this.validateCommand(kind, dto);
      if (kind === Kind.ORGANIZATION) {
        const target = await this.scope(tx, id, false);
        this.assertPending(target, dto.expectedVersion);
        if (target.parentId !== null || !dto.parentId) adminError('STRUCTURE_REFERENCE_INVALID', 400);
        await this.scope(tx, dto.parentId, true);
        await this.assertNoCycle(tx, 'organizations', id, dto.parentId);
        await invalidateSessions(tx, actor, id);
        const changed = await tx.organization.updateMany({ where: { id, configurationRequired: true, deletedAt: null, version: dto.expectedVersion },
          data: { parentId: dto.parentId, configurationRequired: false, status: 'ACTIVE', version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
        return this.finish(tx, actor, kind, id, id, id, dto.expectedVersion + 1, 'ACTIVE', traceId);
      }
      const target = kind === Kind.DEPARTMENT ? await tx.department.findUnique({ where: { id } }) : await tx.position.findUnique({ where: { id } });
      if (!target || target.deletedAt) adminError('STRUCTURE_NOT_FOUND', 404);
      this.assertPending(target, dto.expectedVersion);
      const scope = await this.scope(tx, target.organizationId, false);
      if (scope.deletedAt) {
        if (!dto.targetOrganizationId || !dto.targetDepartmentId || dto.parentId !== undefined) adminError('STRUCTURE_REFERENCE_INVALID', 400);
        const destination = await this.scope(tx, dto.targetOrganizationId, true);
        await this.department(tx, dto.targetDepartmentId, destination.id);
        let replacementId = dto.targetDepartmentId;
        if (kind === Kind.POSITION) {
          const id = randomUUID();
          const occupied = await tx.position.findUnique({ where: { organizationId_code: { organizationId: destination.id, code: target.code } }, select: { id: true } });
          // Keep the full new identity suffix within the existing 64-character code limit.
          const code = occupied ? `${target.code.slice(0, 27)}-${id}` : target.code;
          const replacement = await tx.position.create({ data: { id, organizationId: destination.id, departmentId: dto.targetDepartmentId,
            code, name: target.name, status: 'DISABLED', configurationRequired: false } });
          replacementId = replacement.id;
        }
        await tx.$executeRaw`INSERT INTO administrative_configuration_links
          (kind, source_id, source_orgid, replacement_id, replacement_orgid, actor_id)
          VALUES (${kind}, ${id}::uuid, ${scope.id}::uuid, ${replacementId}::uuid, ${destination.id}::uuid, ${actor.id}::uuid)`;
        const where = { id, organizationId: scope.id, version: dto.expectedVersion, deletedAt: null, configurationRequired: true };
        const data = { status: 'DISABLED' as const, configurationRequired: false, version: { increment: 1 } };
        const changed = kind === Kind.DEPARTMENT ? await tx.department.updateMany({ where, data }) : await tx.position.updateMany({ where, data });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
        const result = await this.finish(tx, actor, kind, id, scope.id, destination.id, dto.expectedVersion + 1, 'DISABLED', traceId);
        return { ...result, replacementId };
      }
      await this.scope(tx, scope.id, true);
      if (dto.targetOrganizationId && dto.targetOrganizationId !== scope.id) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      if (kind === Kind.DEPARTMENT) {
        if (dto.targetDepartmentId !== undefined) adminError('STRUCTURE_REFERENCE_INVALID', 400);
        if (dto.parentId) {
          await this.department(tx, dto.parentId, scope.id);
          await this.assertNoCycle(tx, 'departments', id, dto.parentId);
        }
        const changed = await tx.department.updateMany({ where: { id, organizationId: scope.id, version: dto.expectedVersion, deletedAt: null, configurationRequired: true },
          data: { parentId: dto.parentId ?? null, configurationRequired: false, status: 'ACTIVE', version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      } else {
        if (!dto.targetDepartmentId) adminError('STRUCTURE_REFERENCE_INVALID', 400);
        await this.department(tx, dto.targetDepartmentId, scope.id);
        const changed = await tx.position.updateMany({ where: { id, organizationId: scope.id, version: dto.expectedVersion, deletedAt: null, configurationRequired: true },
          data: { departmentId: dto.targetDepartmentId, configurationRequired: false, status: 'DISABLED', version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      }
      return this.finish(tx, actor, kind, id, scope.id, scope.id, dto.expectedVersion + 1, kind === Kind.DEPARTMENT ? 'ACTIVE' : 'DISABLED', traceId);
    }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      if (kind === Kind.ORGANIZATION) {
        const scope = await this.scope(tx, id, false);
        if (scope.deletedAt) adminError('ORGANIZATION_NOT_FOUND', 404);
      } else {
        const table = kind === Kind.DEPARTMENT ? Prisma.sql`departments` : Prisma.sql`positions`;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id = ${id}::uuid FOR UPDATE`);
        const target = kind === Kind.DEPARTMENT ? await tx.department.findUnique({ where: { id } }) : await tx.position.findUnique({ where: { id } });
        if (!target || target.deletedAt) adminError('STRUCTURE_NOT_FOUND', 404);
        await this.scope(tx, target.organizationId, false);
      }
      await this.authorize(tx, actor, true);
    });
  }

  private assertPending(target: { version: number; configurationRequired: boolean; deletedAt: Date | null }, version: number) {
    if (target.deletedAt) adminError('STRUCTURE_NOT_FOUND', 404);
    if (!target.configurationRequired || target.version !== version) adminError('CONCURRENCY_CONFLICT', 409);
  }

  private validateCommand(kind: StructureReconfigurationKind, dto: AdministrativeReconfigurationDto) {
    if (!Number.isInteger(dto.expectedVersion) || dto.expectedVersion < 1 || dto.expectedVersion > 2147483646
      || (kind === Kind.ORGANIZATION && (dto.targetOrganizationId !== undefined || dto.targetDepartmentId !== undefined))
      || (kind === Kind.POSITION && dto.parentId !== undefined)) adminError('STRUCTURE_REFERENCE_INVALID', 400);
  }

  private async department(tx: AdminTransaction, id: string, organizationId: string) {
    await tx.$queryRaw`SELECT id FROM departments WHERE id = ${id}::uuid FOR UPDATE`;
    if (!await tx.department.findFirst({ where: { id, organizationId, status: 'ACTIVE', deletedAt: null, configurationRequired: false } })) adminError('STRUCTURE_REFERENCE_INVALID', 400);
  }

  private async assertNoCycle(tx: AdminTransaction, table: 'organizations' | 'departments', id: string, parentId: string) {
    const name = table === 'organizations' ? Prisma.sql`organizations` : Prisma.sql`departments`;
    const ancestors = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM ${name} WHERE id = ${parentId}::uuid
      UNION SELECT p.id, p.parent_id FROM ${name} p JOIN ancestors a ON p.id = a.parent_id
    ) SELECT id FROM ancestors`);
    if (ancestors.some(row => row.id === id)) adminError('STRUCTURE_REFERENCE_INVALID', 400);
  }

  private async finish(tx: AdminTransaction, actor: AdminActor, kind: StructureReconfigurationKind, id: string, originalOrganizationId: string,
    targetOrganizationId: string, version: number, status: 'ACTIVE' | 'DISABLED', traceId: string): Promise<AdministrativeReconfigurationResultDto> {
    await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: `${kind}_RECONFIGURED`, resourceType: kind,
      resourceId: id, outcome: 'SUCCESS', traceId, metadata: { originalOrganizationId, organizationId: targetOrganizationId, resourceVersion: version, status } }, tx);
    return { kind, id, originalOrganizationId, targetOrganizationId, version, status, configurationRequired: false };
  }
}
