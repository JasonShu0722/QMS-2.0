import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { LegacyAuthorizationOwnerService, type LegacyAuthorizationHistoryFilter } from '../authorization/legacy-authorization-owner.service.js';
import { LegacyAuthorizationIdentityService } from '../identity/legacy-authorization-identity.service.js';
import type { LegacyAuthorizationHistoryDto, LegacyAuthorizationHistoryQueryDto, LegacyAuthorizationSourcesQueryDto } from './legacy-authorization-read.dto.js';
import type { LegacyAuthorizationLabelsDto, LegacyAuthorizationRoleDto } from './legacy-authorization-migration.dto.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown) => typeof value === 'string' ? value : null;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
function roleLabel(value: unknown): LegacyAuthorizationRoleDto | null {
  const row = object(value);
  if (typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string') return null;
  return { id: row.id, organizationId: text(row.organizationId), code: row.code, name: row.name, mfaRequired: row.mfaRequired === true, permissionCodes: strings(row.permissionCodes), platformMarker: row.platformMarker === true };
}
function projectLabels(value: unknown): LegacyAuthorizationLabelsDto | null {
  const labels = object(value);
  if (!Array.isArray(labels.users) || !Array.isArray(labels.positions) || !Array.isArray(labels.organizations)) return null;
  return {
    users: rows(labels.users).map(row => ({ id: text(row.id)!, organizationId: text(row.organizationId)!, username: text(row.username)!, fullName: text(row.fullName), status: text(row.status)!, unavailable: row.unavailable === true })),
    positions: rows(labels.positions).map(row => ({ id: text(row.id)!, organizationId: text(row.organizationId)!, departmentId: text(row.departmentId), department: row.department ? { id: text(object(row.department).id)!, code: text(object(row.department).code)!, name: text(object(row.department).name)! } : null, code: text(row.code)!, name: text(row.name)!, status: text(row.status)!, version: Number(row.version), roleVersion: Number(row.roleVersion), unavailable: row.unavailable === true })),
    organizations: rows(labels.organizations).map(row => ({ id: text(row.id)!, code: text(row.code)!, name: text(row.name)! })),
  };
}

@Injectable()
export class LegacyAuthorizationReadService {
  constructor(private readonly prisma: PrismaService, private readonly roles: LegacyAuthorizationOwnerService, private readonly identities: LegacyAuthorizationIdentityService) {}

  private async access(tx: AdminTransaction, actor: AdminActor, organizationId: string, entry = false) {
    if (actor.accountType !== 'INTERNAL' || (entry && (actor.scopeOrganizationId ?? actor.organizationId) !== organizationId)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, ['account:roles:read', 'organization:structure:read', 'account:users:read']);
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, deletedAt: true, configurationRequired: true } });
    if (organization?.type !== 'INTERNAL' || organization.deletedAt || organization.configurationRequired) adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  history(actor: AdminActor, organizationId: string, query: LegacyAuthorizationHistoryQueryDto) {
    return this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId, true);
      return this.readHistory(tx, actor, { organizationId, ...(query.roleId ? { roleId: query.roleId } : {}) }, query);
    }, { isolationLevel: 'RepeatableRead' });
  }

  private async readHistory(tx: AdminTransaction, actor: AdminActor, filter: LegacyAuthorizationHistoryFilter, page: { pageSize: number; offset: number }) {
    // Authorize every matching fact before pagination, so offset cannot expose an unauthorized total.
    for (const scope of await this.roles.historyScopes(tx, filter)) await this.access(tx, actor, scope.organizationId);
    const history = await this.roles.history(tx, filter, { pageSize: page.pageSize, offset: page.offset });
    return { ...history, items: history.items.map(row => this.projectHistory(row)) };
  }

  private projectHistory(row: { id: string; organizationId: string; roleId: string; actorUserId: string; operation: string; createdAt: Date; snapshot: unknown }): LegacyAuthorizationHistoryDto {
    const preview = object(object(row.snapshot).preview);
    const labels = projectLabels(preview.labels);
    const target = object(preview.target);
    return {
      archiveId: row.id, organizationId: row.organizationId, roleId: row.roleId, actorUserId: row.actorUserId, operation: row.operation, createdAt: row.createdAt.toISOString(), state: 'HISTORICAL', role: roleLabel(preview.role),
      directSources: rows(preview.directSources).map(source => ({ userId: text(source.userId)!, organizationId: text(source.organizationId)!, roleId: text(source.roleId)!, selected: source.selected === true, initialization: source.initialization === true })),
      mappedSources: rows(preview.mappedSources).map(source => ({ positionId: text(source.positionId)!, organizationId: text(source.organizationId)!, roleId: text(source.roleId)!, isCanonical: source.isCanonical === true, selected: source.selected === true,
        assignments: rows(source.assignments).map(assignment => ({ id: text(assignment.id)!, userId: text(assignment.userId)!, positionId: text(assignment.positionId)!, startedAt: text(assignment.startedAt)!, endedAt: text(assignment.endedAt), temporalState: text(assignment.temporalState)! })) })),
      target: preview.target === null || !text(target.positionId) ? null : { positionId: text(target.positionId), canonicalRoleId: text(target.canonicalRoleId)!, roleCode: text(target.roleCode)!, departmentId: text(target.departmentId), code: text(target.code)!, name: text(target.name)!, originalCanonical: roleLabel(target.originalCanonical), strategy: text(target.strategy)!, permissionCodes: strings(target.permissionCodes), mfaRequired: target.mfaRequired === true },
      retainedSourceCount: typeof preview.retainedSourceCount === 'number' ? preview.retainedSourceCount : null, labels, labelsUnavailable: labels === null,
    };
  }

  sources(actor: AdminActor, organizationId: string, query: LegacyAuthorizationSourcesQueryDto) {
    if (Number(query.userId !== undefined) + Number(query.positionId !== undefined) !== 1) throw new BadRequestException('Select exactly one userId or positionId');
    return this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId, true);
      const user = query.userId ? await this.identities.subject(tx, query.userId) : null;
      const position = query.positionId ? await tx.position.findUnique({ where: { id: query.positionId }, select: { id: true, organizationId: true } }) : null;
      if ((query.userId && (!user || user.organizationId !== organizationId || user.accountType !== 'INTERNAL'))
        || (query.positionId && (!position || position.organizationId !== organizationId))) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      const positions = Prisma.sql`SELECT p.id, p.organization_id,
        COALESCE(p.status = 'ACTIVE' AND p.deleted_at IS NULL AND NOT p.configuration_required AND o.status = 'ACTIVE' AND o.deleted_at IS NULL AND NOT o.configuration_required
          AND (p.department_id IS NULL OR (d.status = 'ACTIVE' AND d.deleted_at IS NULL AND NOT d.configuration_required)), FALSE) AS available,
        jsonb_build_object('id', p.id, 'organizationId', p.organization_id, 'departmentId', p.department_id,
          'department', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) END,
          'code', p.code, 'name', p.name, 'status', p.status, 'version', p.version, 'roleVersion', p.role_version, 'unavailable', p.deleted_at IS NOT NULL OR p.configuration_required) AS label
        FROM positions p JOIN organizations o ON o.id = p.organization_id LEFT JOIN departments d ON d.id = p.department_id AND d.organization_id = p.organization_id`;
      const sourceQuery = this.roles.sourceQuery(query, this.identities.sourceMemberships(query), positions, !!user && user.status === 'ACTIVE' && !user.deletedAt && !user.configurationRequired);
      const scopes = [...new Set([organizationId, ...(await this.roles.sourceScopes(tx, sourceQuery)).map(row => row.organizationId)])];
      for (const scope of scopes) await this.access(tx, actor, scope);
      const page = { pageSize: query.pageSize, offset: query.offset };
      const current = await this.roles.sources(tx, sourceQuery, page);
      const history = await this.readHistory(tx, actor, { organizationId, ...(query.userId ? { userId: query.userId } : { positionId: query.positionId }) }, page);
      const userLabels = new Map<string, LegacyAuthorizationLabelsDto['users'][number]>();
      if (user) userLabels.set(user.id, { id: user.id, organizationId: user.organizationId, username: user.username, fullName: user.fullName, status: user.status, unavailable: user.status !== 'ACTIVE' || !!user.deletedAt || user.configurationRequired });
      for (const row of current.items) if (row.userId && row.username && row.userOrganizationId) userLabels.set(row.userId, { id: row.userId, organizationId: row.userOrganizationId, username: row.username, fullName: row.fullName, status: row.userStatus!, unavailable: !row.userAvailable });
      const labelScopes = [...new Set([organizationId, ...current.items.flatMap(row => [row.organizationId, row.userOrganizationId, roleLabel(row.role)?.organizationId].filter((id): id is string => !!id))])];
      return {
        currentSources: { ...current, items: current.items.map(row => ({ organizationId: row.organizationId, userId: row.userId, positionId: row.positionId, assignmentId: row.assignmentId,
          startedAt: row.startedAt?.toISOString() ?? null, endedAt: row.endedAt?.toISOString() ?? null, kind: row.kind, temporalState: row.temporalState, active: row.temporalState === 'CURRENT', role: roleLabel(row.role)! })) },
        history, labels: { users: [...userLabels.values()], positions: [...new Map(current.items.filter(row => row.position).map(row => [row.positionId, object(row.position)])).values()],
          organizations: await tx.organization.findMany({ where: { id: { in: labelScopes } }, select: { id: true, code: true, name: true }, orderBy: { id: 'asc' } }) },
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
