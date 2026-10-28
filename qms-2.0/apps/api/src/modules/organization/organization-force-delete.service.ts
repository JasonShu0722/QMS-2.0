import { Injectable } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { assertRecentAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { adminMutationDigests } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { OrganizationForceDeleteDto, OrganizationForceDeletePreviewDto, OrganizationForceDeleteResultDto } from './organization-force-delete.dto.js';

type Kind = 'ORGANIZATION' | 'DEPARTMENT';
type Target = { id: string; name: string; code: string; version: number; parentId: string | null; deletedAt: Date | null };
type Impact = { target: Target; impact: AdministrativeLifecycleImpact; assignmentIds: string[]; bindingIds: string[]; ministerIds: string[]; private: object };
const permission = (kind: Kind) => kind === 'ORGANIZATION' ? 'organization:force-delete' : 'organization:departments:force-delete';
const action = (kind: Kind) => `${kind}_FORCE_DELETED`;
const retainedHistory = ['保留原组织归属、历史身份 UUID、业务记录、审批签章、审计日志及既有回执。', '下级组织、子部门、岗位和用户不会级联删除；失效的当前关联需重新配置。'];
const ids = (rows: { id: string }[]) => rows.map(row => row.id);
const uuidList = (values: string[]) => Prisma.join(values.map(value => Prisma.sql`${value}::uuid`));

@Injectable()
export class OrganizationForceDeleteService {
  private readonly secret: string;

  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService, private readonly registry: AdministrativeLifecycleRegistry) {
    const configured = process.env.QMS_RATE_LIMIT_SECRET?.trim();
    if (!configured && process.env.NODE_ENV === 'production') throw new Error('QMS_RATE_LIMIT_SECRET must be configured in production');
    this.secret = configured ?? 'qms-development-rate-limit-secret-not-for-production';
  }

  previewOrganization(actor: AdminActor, organizationId: string) {
    return this.preview(actor, organizationId, 'ORGANIZATION', organizationId);
  }

  previewDepartment(actor: AdminActor, organizationId: string, departmentId: string) {
    return this.preview(actor, organizationId, 'DEPARTMENT', departmentId);
  }

  forceDeleteOrganization(actor: AdminActor, organizationId: string, dto: OrganizationForceDeleteDto, traceId: string, key?: string) {
    return this.remove(actor, organizationId, 'ORGANIZATION', organizationId, dto, traceId, key);
  }

  forceDeleteDepartment(actor: AdminActor, organizationId: string, departmentId: string, dto: OrganizationForceDeleteDto, traceId: string, key?: string) {
    return this.remove(actor, organizationId, 'DEPARTMENT', departmentId, dto, traceId, key);
  }

  private async preview(actor: AdminActor, organizationId: string, kind: Kind, entityId: string): Promise<OrganizationForceDeletePreviewDto> {
    try {
      return await this.prisma.$transaction(async tx => {
        await assertRecentAuthentication(tx, actor);
        await this.authorize(tx, actor, organizationId, kind);
        const selection = await this.collect(tx, actor, organizationId, kind, entityId);
        this.assertTarget(actor, kind, selection.target);
        return this.summary(selection, actor);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  private async remove(actor: AdminActor, organizationId: string, kind: Kind, entityId: string,
    dto: OrganizationForceDeleteDto, traceId: string, key?: string): Promise<OrganizationForceDeleteResultDto> {
    let selection: Impact;
    return this.mutations.run({ actor, organizationId: actor.organizationId, permission: permission(kind), key,
      action: action(kind), payload: { kind, organizationId, entityId, scopeOrganizationId: actor.scopeOrganizationId ?? actor.organizationId,
        expectedVersion: dto.expectedVersion, confirmed: dto.confirmed, previewToken: dto.previewToken }, traceId, isolationLevel: 'ReadCommitted' }, async tx => {
      if (!Number.isInteger(dto.expectedVersion) || dto.expectedVersion < 1 || dto.confirmed !== true
        || typeof dto.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(dto.previewToken)) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      if (selection.target.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const before = this.summary(selection, actor);
      if (!timingSafeEqual(Buffer.from(dto.previewToken, 'hex'), Buffer.from(before.previewToken, 'hex'))) adminError('CONCURRENCY_CONFLICT', 409);
      const now = new Date();
      // All effects share this transaction; a missing/failed participant aborts the command.
      const effects = await this.registry.apply(tx, actor, selection.impact);
      await this.invalidateStructure(tx, actor, selection, now);
      const code = `DELETED.${entityId.replaceAll('-', '')}`;
      const data = { code, status: 'DISABLED' as const, deletedAt: now, configurationRequired: false, version: { increment: 1 } };
      const changed = kind === 'ORGANIZATION'
        ? await tx.organization.updateMany({ where: { id: entityId, version: dto.expectedVersion, deletedAt: null }, data })
        : await tx.department.updateMany({ where: { organizationId, id: entityId, version: dto.expectedVersion, deletedAt: null }, data });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      // The actor must retain a real platform marker after detaching any marker source.
      // With the shared lifecycle lock this also prevents deleting the last usable administrator.
      if (!await hasPlatformAdministrator(tx, actor.id)) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      await assertAdminAccess(tx, actor, actor.organizationId, permission(kind));
      const result = { ...before, version: dto.expectedVersion + 1, deletedAt: now.toISOString(), effects };
      const identity = { code: selection.target.code, name: selection.target.name, parentId: selection.target.parentId,
        ...(kind === 'ORGANIZATION' ? { type: 'INTERNAL' } : { organizationId }) };
      await tx.$executeRaw`INSERT INTO administrative_deletions
        (id, scope_organization_id, entity_kind, entity_id, original_organization_id, actor_user_id, original_identity, impact)
        VALUES (${randomUUID()}::uuid, ${actor.organizationId}::uuid, ${kind}, ${entityId}::uuid, ${organizationId}::uuid,
        ${actor.id}::uuid, ${JSON.stringify(identity)}::jsonb, ${JSON.stringify({ ...selection.impact, counts: result.counts, effects })}::jsonb)`;
      await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: action(kind), resourceType: kind === 'ORGANIZATION' ? 'Organization' : 'Department',
        resourceId: entityId, outcome: 'SUCCESS', traceId, metadata: { organizationId, structureCode: before.code, structureName: before.name, resourceVersion: result.version } }, tx);
      return result;
    }, async tx => {
      // AdminMutation currently locks actor first. Opposing lock order must propagate as mapped 409.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      await this.authorize(tx, actor, organizationId, kind, true);
      await this.lockImpact(tx, organizationId, kind, entityId);
      await assertRecentAuthentication(tx, actor);
      await this.authorize(tx, actor, organizationId, kind, true);
      selection = await this.collect(tx, actor, organizationId, kind, entityId);
      if (selection.target.deletedAt) {
        if (!key) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
        const receipt = await tx.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: actor.id, organizationId: actor.organizationId, key } } });
        const value = (receipt?.response as { value?: { id?: string; kind?: string } } | undefined)?.value;
        const tombstones = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM administrative_deletions
          WHERE scope_organization_id = ${actor.organizationId}::uuid AND actor_user_id = ${actor.id}::uuid
          AND entity_kind = ${kind} AND entity_id = ${entityId}::uuid AND original_organization_id = ${organizationId}::uuid`;
        if (!tombstones.length || receipt?.action !== action(kind) || value?.id !== entityId || value.kind !== kind) {
          adminError(kind === 'ORGANIZATION' ? 'ORGANIZATION_NOT_FOUND' : 'STRUCTURE_NOT_FOUND', 404);
        }
      } else {
        this.assertTarget(actor, kind, selection.target);
      }
    });
  }

  private async authorize(tx: AdminTransaction, actor: AdminActor, organizationId: string, kind: Kind, replay = false) {
    const home = await tx.organization.findUnique({ where: { id: actor.organizationId } });
    if (actor.accountType !== 'INTERNAL' || home?.type !== 'INTERNAL' || home.deletedAt || home.configurationRequired
      || !await hasPlatformAdministrator(tx, actor.id)) adminError('FEATURE_PERMISSION_DENIED', 403);
    await assertAdminAccess(tx, actor, actor.organizationId, permission(kind));
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization || (organization.deletedAt && (!replay || kind !== 'ORGANIZATION'))) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (organization.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    // The real platform marker covers INTERNAL targets, including disabled ones;
    // the independent force permission is checked against the surviving actor home.
  }

  private assertTarget(actor: AdminActor, kind: Kind, target: Target) {
    if (target.deletedAt) adminError(kind === 'ORGANIZATION' ? 'ORGANIZATION_NOT_FOUND' : 'STRUCTURE_NOT_FOUND', 404);
    if (kind === 'ORGANIZATION' && (!target.parentId || target.id === actor.organizationId)) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
  }

  private async lockImpact(tx: AdminTransaction, organizationId: string, kind: Kind, entityId: string) {
    // Scope/structure UPDATE locks fence writers and FK insertions before collecting the server impact.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid ORDER BY id FOR UPDATE`;
    if (kind === 'ORGANIZATION') await tx.$queryRaw`SELECT id FROM organizations WHERE parent_id = ${organizationId}::uuid ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid
      AND (${kind} = 'ORGANIZATION' OR id = ${entityId}::uuid OR parent_id = ${entityId}::uuid) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM positions WHERE organization_id = ${organizationId}::uuid
      AND (${kind} = 'ORGANIZATION' OR department_id = ${entityId}::uuid) ORDER BY id FOR UPDATE`;
    const selection = await this.collect(tx, { organizationId }, organizationId, kind, entityId);
    if (selection.impact.userIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${uuidList(selection.impact.userIds)}) ORDER BY id FOR UPDATE`);
    if (selection.assignmentIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM user_positions WHERE id IN (${uuidList(selection.assignmentIds)}) ORDER BY id FOR UPDATE`);
    if (selection.bindingIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM department_management_bindings WHERE id IN (${uuidList(selection.bindingIds)}) ORDER BY id FOR UPDATE`);
    if (selection.ministerIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM department_minister_scopes WHERE id IN (${uuidList(selection.ministerIds)}) ORDER BY id FOR UPDATE`);
  }

  private async collect(tx: AdminTransaction, actor: Pick<AdminActor, 'organizationId'>, organizationId: string, kind: Kind, entityId: string): Promise<Impact> {
    const target = kind === 'ORGANIZATION' ? await tx.organization.findUnique({ where: { id: entityId } })
      : await tx.department.findFirst({ where: { id: entityId, organizationId } });
    if (!target) adminError(kind === 'ORGANIZATION' ? 'ORGANIZATION_NOT_FOUND' : 'STRUCTURE_NOT_FOUND', 404);
    const departments = await tx.department.findMany({ where: { organizationId, deletedAt: null,
      ...(kind === 'DEPARTMENT' ? { OR: [{ id: entityId }, { parentId: entityId }] } : {}) }, select: { id: true, version: true, parentId: true, status: true, configurationRequired: true }, orderBy: { id: 'asc' } });
    const positions = await tx.position.findMany({ where: { organizationId, deletedAt: null,
      ...(kind === 'DEPARTMENT' ? { departmentId: entityId } : {}) }, select: { id: true, version: true, roleVersion: true, departmentId: true, status: true, configurationRequired: true }, orderBy: { id: 'asc' } });
    const organizations = kind === 'ORGANIZATION' ? await tx.organization.findMany({ where: { parentId: entityId, deletedAt: null }, select: { id: true, version: true, parentId: true, status: true, configurationRequired: true }, orderBy: { id: 'asc' } }) : [];
    const assignments = await tx.userPosition.findMany({ where: { organizationId, ...(kind === 'DEPARTMENT' ? { positionId: { in: ids(positions) } } : {}),
      OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] }, select: { id: true, userId: true, positionId: true, startedAt: true, endedAt: true }, orderBy: { id: 'asc' } });
    const users = await tx.user.findMany({ where: { organizationId, deletedAt: null,
      ...(kind === 'DEPARTMENT' ? { id: { in: assignments.map(row => row.userId) } } : {}) }, select: { id: true, securityVersion: true, status: true, configurationRequired: true }, orderBy: { id: 'asc' } });
    const positionCondition = positions.length ? Prisma.sql`OR position_id IN (${uuidList(ids(positions))})` : Prisma.empty;
    const bindingIds = await tx.$queryRaw<{ id: string; version: number; department_id: string; position_id: string; responsibility: string }[]>(Prisma.sql`SELECT id, version, department_id, position_id, responsibility FROM department_management_bindings
      WHERE organization_id = ${organizationId}::uuid AND status = 'ACTIVE'
      AND (${kind} = 'ORGANIZATION' OR department_id = ${entityId}::uuid ${positionCondition}) ORDER BY id`);
    const assignmentCondition = assignments.length ? Prisma.sql`OR minister_assignment_id IN (${uuidList(ids(assignments))})` : Prisma.empty;
    const ministerIds = await tx.$queryRaw<{ id: string; version: number; department_id: string; section_department_id: string; minister_assignment_id: string; valid_from: Date; valid_to: Date | null }[]>(Prisma.sql`SELECT id, version, department_id, section_department_id, minister_assignment_id, valid_from, valid_to FROM department_minister_scopes
      WHERE organization_id = ${organizationId}::uuid AND status = 'ACTIVE'
      AND (${kind} = 'ORGANIZATION' OR department_id = ${entityId}::uuid OR section_department_id = ${entityId}::uuid ${assignmentCondition}) ORDER BY id`);
    return { target, assignmentIds: ids(assignments), bindingIds: ids(bindingIds), ministerIds: ids(ministerIds),
      private: { departments, positions, organizations, assignments, users, bindings: bindingIds, ministerScopes: ministerIds }, impact: {
      kind, entityId, organizationId, receiptOrganizationId: actor.organizationId, userIds: ids(users), departmentIds: ids(departments),
      positionIds: ids(positions), organizationIds: kind === 'ORGANIZATION' ? [entityId, ...ids(organizations)] : [],
    } };
  }

  private summary(selection: Impact, actor: AdminActor): OrganizationForceDeletePreviewDto {
    const { target, impact } = selection;
    // Private references bind confirmation, but never enter the public summary or domain impact.
    const previewToken = adminMutationDigests(JSON.stringify({ purpose: 'qms:organization-force-delete-preview:v1',
      actor: { id: actor.id, organizationId: actor.organizationId, scopeOrganizationId: actor.scopeOrganizationId ?? actor.organizationId, accountType: actor.accountType },
      organizationId: impact.organizationId, kind: impact.kind, id: target.id, version: target.version, baseline: selection.private }), this.secret)[0]!;
    return { kind: impact.kind as Kind, id: target.id, name: target.name, code: target.code, version: target.version,
      previewToken,
      counts: { users: impact.userIds.length, departments: impact.departmentIds.length, positions: impact.positionIds.length,
        organizations: impact.organizationIds.length, assignments: selection.assignmentIds.length, managementBindings: selection.bindingIds.length, ministerScopes: selection.ministerIds.length },
      retainedHistory: [...retainedHistory] };
  }

  private async invalidateStructure(tx: AdminTransaction, actor: AdminActor, selection: Impact, now: Date) {
    const { impact } = selection;
    const pending = { status: 'DISABLED' as const, configurationRequired: true, version: { increment: 1 } };
    if (impact.kind === 'ORGANIZATION') {
      await tx.organization.updateMany({ where: { id: { in: impact.organizationIds.filter(id => id !== impact.entityId) }, deletedAt: null }, data: { ...pending, parentId: null } });
    }
    await tx.department.updateMany({ where: { id: { in: impact.departmentIds.filter(id => impact.kind === 'ORGANIZATION' || id !== impact.entityId) }, organizationId: impact.organizationId, deletedAt: null },
      data: { ...pending, ...(impact.kind === 'DEPARTMENT' ? { parentId: null } : {}) } });
    await tx.position.updateMany({ where: { id: { in: impact.positionIds }, organizationId: impact.organizationId, deletedAt: null }, data: pending });
    await tx.userPosition.updateMany({ where: { id: { in: selection.assignmentIds }, organizationId: impact.organizationId,
      OR: [{ endedAt: null }, { endedAt: { gt: now } }] }, data: { endedAt: now } });
    if (selection.bindingIds.length) await tx.$executeRaw(Prisma.sql`UPDATE department_management_bindings SET status = 'DISABLED', version = version + 1,
      updated_at = ${now}, updated_by = ${actor.id}::uuid WHERE organization_id = ${impact.organizationId}::uuid AND id IN (${uuidList(selection.bindingIds)}) AND status = 'ACTIVE'`);
    if (selection.ministerIds.length) await tx.$executeRaw(Prisma.sql`UPDATE department_minister_scopes SET status = 'DISABLED', version = version + 1,
      updated_at = ${now}, updated_by = ${actor.id}::uuid WHERE organization_id = ${impact.organizationId}::uuid AND id IN (${uuidList(selection.ministerIds)}) AND status = 'ACTIVE'`);
  }
}
