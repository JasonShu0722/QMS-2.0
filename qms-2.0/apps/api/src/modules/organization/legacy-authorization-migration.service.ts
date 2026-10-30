import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { adminMutationDigests } from '../../common/security/security-keyring.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { isGovernancePermission } from '../../common/security/session-security.js';
import { effectiveMfa } from '../../common/security/mfa-policy.js';
import { LegacyAuthorizationOwnerService } from '../authorization/legacy-authorization-owner.service.js';
import { LegacyAuthorizationIdentityService } from '../identity/legacy-authorization-identity.service.js';
import { LegacyRoleReferenceReadModel } from '../workflow/legacy-role-reference.read-model.js';
import { effectiveRoleGrants, hasPlatformAdministrator, projectEffectiveRoleGrants, type EffectiveRoleGrant } from '../../common/security/effective-role-grants.js';
import { ACTIVE_PERMISSION_CODES } from '../authorization/permission-catalog.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { LegacyAuthorizationCommitDto, LegacyAuthorizationPreviewInputDto } from './legacy-authorization-migration.dto.js';

function stableId(value: string) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const positionSelect = { id: true, organizationId: true, departmentId: true, code: true, name: true, status: true, version: true, roleVersion: true, deletedAt: true, configurationRequired: true,
  department: { select: { id: true, code: true, name: true, version: true, status: true, deletedAt: true, configurationRequired: true } },
  roles: { select: { roleId: true, isCanonical: true }, orderBy: { roleId: 'asc' as const } } } as const;

@Injectable()
export class LegacyAuthorizationMigrationService {
  constructor(private readonly prisma: PrismaService, private readonly roles: LegacyAuthorizationOwnerService,
    private readonly identities: LegacyAuthorizationIdentityService, private readonly workflows: LegacyRoleReferenceReadModel,
    private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  async list(actor: AdminActor, organizationId: string) {
    return this.prisma.$transaction(async tx => {
      await this.access(tx, actor, organizationId);
      return this.roles.list(tx, organizationId);
    });
  }

  async preview(actor: AdminActor, organizationId: string, roleId: string, input: LegacyAuthorizationPreviewInputDto) {
    return this.prisma.$transaction(async tx => (await this.snapshot(tx, actor, organizationId, roleId, input)).preview, { isolationLevel: 'RepeatableRead' });
  }

  commit(actor: AdminActor, organizationId: string, roleId: string, input: LegacyAuthorizationCommitDto, traceId: string, key?: string) {
    const permission = ['organization:structure:manage', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign', input.operation === 'REMOVE' ? 'account:roles:delete' : 'account:roles:update', ...(input.newPosition ? ['account:roles:create'] : [])];
    return this.mutations.run({ actor, organizationId, key, traceId, permission, action: 'LEGACY_AUTHORIZATION_COMMITTED', payload: { roleId, ...input } }, async tx => {
      const state = await this.snapshot(tx, actor, organizationId, roleId, input, true);
      const granted = await assertAdminAccess(tx, actor, organizationId, permission);
      if (!state.digests.includes(input.authorizationBaseline)
        || JSON.stringify([...input.confirmedImpactUserIds].sort()) !== JSON.stringify(state.preview.impactUserIds)) adminError('CONCURRENCY_CONFLICT', 409);
      if (state.preview.target?.permissionCodes.some(code => code !== 'platform:admin' && (!ACTIVE_PERMISSION_CODES.includes(code) || !granted.includes(code)))
        || state.source.role.permissionCodes.some(code => code !== 'platform:admin' && !granted.includes(code))
        || ((state.source.role.platformMarker || state.preview.target?.permissionCodes.includes('platform:admin')) && !await hasPlatformAdministrator(tx, actor.id))) adminError('FEATURE_PERMISSION_DENIED', 403);
      const affected = state.preview.impactUserIds;
      let targetPositionId: string | undefined;
      if (input.operation === 'MIGRATE') {
        targetPositionId = state.preview.target!.positionId;
        if (input.newPosition) await tx.position.create({ data: { id: targetPositionId, organizationId, ...input.newPosition, name: input.newPosition.name.trim() } });
        await this.roles.apply(tx, { organizationId, roleId, directUserIds: input.directUserIds, sourcePositionIds: input.sourcePositionIds, targetPositionId,
          strategy: state.strategy, canonicalId: state.canonical?.id, targetName: state.preview.target!.name, permissionCodes: state.preview.target!.permissionCodes, mfaRequired: state.preview.target!.mfaRequired, stableRoleCode: state.source.role.code });
        const windows = [
          ...input.directUserIds.map(userId => ({ userId, startedAt: state.now, endedAt: null as Date | null })),
          ...state.assignments.filter(row => input.sourcePositionIds.includes(row.positionId) && (!row.endedAt || row.endedAt > state.now)).map(({ userId, startedAt, endedAt }) => ({ userId, startedAt, endedAt })),
        ];
        for (const window of windows) {
          const existing = await tx.userPosition.findMany({ where: { organizationId, positionId: targetPositionId, userId: window.userId } });
          const same = existing.some(row => row.startedAt <= window.startedAt && (row.endedAt === null || (window.endedAt !== null && row.endedAt >= window.endedAt)));
          if (same) continue;
          const unbounded = window.endedAt === null ? existing.find(row => row.endedAt === null) : undefined;
          // Union only two already-unbounded sources; bounded windows keep their exact original dates.
          if (unbounded) {
            await tx.userPosition.update({ where: { id: unbounded.id }, data: { startedAt: window.startedAt < unbounded.startedAt ? window.startedAt : unbounded.startedAt } });
            continue;
          }
          await tx.userPosition.create({ data: { organizationId, positionId: targetPositionId, ...window } });
        }
      } else await this.roles.apply(tx, { organizationId, roleId, directUserIds: input.directUserIds, sourcePositionIds: input.sourcePositionIds, strategy: 'REMOVE', permissionCodes: [], mfaRequired: false });
      const changedPositionIds = [...new Set([...input.sourcePositionIds, ...(targetPositionId ? [targetPositionId] : [])])];
      if (changedPositionIds.length) await tx.position.updateMany({ where: { id: { in: changedPositionIds } }, data: { roleVersion: { increment: 1 } } });
      const actual = await this.identities.snapshot(tx, affected, organizationId);
      for (const before of state.users.filter(user => affected.includes(user.id))) {
        const after = actual.find(user => user.id === before.id)!;
        if (before.id === actor.id && before.platformAdministrator && !after.platformAdministrator) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
        const predicted = state.preview.affectedUsers.find(user => user.userId === before.id)!;
        const actualPermissions = [...new Set(after.grants.flatMap(grant => grant.role.permissions.map(({ permission: value }) => value.code)))].sort();
        if (JSON.stringify(predicted.afterPermissionCodes) !== JSON.stringify(actualPermissions)
          || JSON.stringify(predicted.afterRoleCodes) !== JSON.stringify([...new Set(after.grants.map(grant => grant.role.code))].sort())
          || predicted.afterMfaRequired !== after.effectiveMfaRequired
          || predicted.afterPlatformAdministrator !== after.platformAdministrator) adminError('CONCURRENCY_CONFLICT', 409);
      }
      if (state.source.role.platformMarker && !await this.identities.hasAnyPlatformAdministrator(tx)) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      const actorBefore = state.users.find(user => user.id === actor.id)!;
      const actorAfter = await effectiveRoleGrants(tx, actor.id, organizationId);
      const afterCodes = new Set(actorAfter.flatMap(grant => grant.role.permissions.map(({ permission: value }) => value.code)));
      if (actorBefore.grants.some(grant => grant.role.permissions.some(({ permission: value }) => granted.includes(value.code) && !afterCodes.has(value.code)))) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      await this.identities.revoke(tx, affected);
      const canDelete = input.operation === 'REMOVE' && state.source.direct.length === 0 && state.source.mappings.length === 0 && state.source.initialization.length === 0 && state.preview.workflowReferences.length === 0
        && !await this.audit.hasResourceHistory(tx, 'Role', roleId);
      const archived = await this.roles.archive(tx, { organizationId, roleId, actorUserId: actor.id, operation: input.operation,
        snapshot: JSON.parse(JSON.stringify({ actorId: actor.id, scopeOrganizationId: organizationId, organization: state.organization, preview: state.preview, positions: state.positions, userVersions: state.users.map(({ id, organizationId: home, securityVersion, credentialVersion }) => ({ id, organizationId: home, securityVersion, credentialVersion })) })) as Prisma.InputJsonValue, canDelete });
      await this.audit.record({ actorUserId: actor.id, organizationId, action: input.operation === 'REMOVE' ? 'LEGACY_AUTHORIZATION_REMOVED' : 'LEGACY_AUTHORIZATION_MIGRATED', resourceType: 'Role', resourceId: roleId, outcome: 'SUCCESS', traceId, metadata: { targetRoleCode: state.source.role.code, ...(targetPositionId ? { positionId: targetPositionId } : {}) } }, tx);
      return { roleId, targetPositionId: targetPositionId ?? null, ...archived, selfSessionRevoked: affected.includes(actor.id) };
    }, async tx => {
      const { granted } = await this.access(tx, actor, organizationId);
      // Receipts confirm a prior result, never bypass the original source/target grant ceiling.
      const required = await this.roles.replayRequirements(tx, { actorUserId: actor.id, organizationId, roleId, operation: input.operation, authorizationBaseline: input.authorizationBaseline, key: key! });
      if (!required) return;
      for (const scope of required.organizationIds) await assertAdminAccess(tx, actor, scope, ['account:roles:read', 'organization:structure:read', 'account:users:read']);
      if (required.permissionCodes.some(code => code !== 'platform:admin' && !granted.includes(code))
        || (required.platformMarker && !await hasPlatformAdministrator(tx, actor.id))) adminError('FEATURE_PERMISSION_DENIED', 403);
    });
  }

  private async access(tx: AdminTransaction, actor: AdminActor, organizationId: string) {
    if (actor.accountType !== 'INTERNAL' || (actor.scopeOrganizationId ?? actor.organizationId) !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const granted = await assertAdminAccess(tx, actor, organizationId, ['organization:structure:read', 'account:roles:read']);
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, code: true, name: true, type: true, version: true, status: true, deletedAt: true, configurationRequired: true } });
    if (organization.type !== 'INTERNAL' || organization.deletedAt || organization.configurationRequired || organization.status !== 'ACTIVE') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return { granted, organization };
  }

  private async snapshot(tx: AdminTransaction, actor: AdminActor, organizationId: string, roleId: string, input: LegacyAuthorizationPreviewInputDto, lock = false) {
    const before = await this.readSnapshot(tx, actor, organizationId, roleId, input);
    if (!lock) return before;
    const positionIds = before.lockPositions.map(row => row.id);
    const departmentIds = [...new Set([...before.lockPositions.flatMap(row => row.departmentId ? [row.departmentId] : []), ...(input.newPosition?.departmentId ? [input.newPosition.departmentId] : [])])].sort();
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    if (departmentIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM departments WHERE id IN (${Prisma.join(departmentIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
    if (positionIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM positions WHERE id IN (${Prisma.join(positionIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    await this.roles.lock(tx, [roleId, ...before.lockPositions.flatMap(row => row.roles.map(mapping => mapping.roleId))]);
    await this.identities.lock(tx, before.users.map(user => user.id));
    await assertRecentAuthentication(tx, actor);
    return this.readSnapshot(tx, actor, organizationId, roleId, input);
  }

  private async readSnapshot(tx: AdminTransaction, actor: AdminActor, organizationId: string, roleId: string, input: LegacyAuthorizationPreviewInputDto) {
    input = { operation: input.operation, directUserIds: [...input.directUserIds].sort(), sourcePositionIds: [...input.sourcePositionIds].sort(),
      ...(input.targetPositionId ? { targetPositionId: input.targetPositionId } : {}), ...(input.newPosition ? { newPosition: input.newPosition } : {}), ...(input.preserveRoleCode === undefined ? {} : { preserveRoleCode: input.preserveRoleCode }) };
    if ((input.operation === 'MIGRATE' && Number(!!input.targetPositionId) + Number(!!input.newPosition) !== 1)
      || (input.operation === 'REMOVE' && (input.targetPositionId || input.newPosition || input.preserveRoleCode))) throw new BadRequestException('Select one migration target, or remove without a target');
    const { organization } = await this.access(tx, actor, organizationId);
    const source = await this.roles.snapshot(tx, organizationId, roleId);
    const scopes = [...new Set([organizationId, ...source.direct.map(row => row.organizationId), ...source.mappings.map(row => row.organizationId)])].sort();
    for (const scope of scopes) {
      await assertAdminAccess(tx, actor, scope, ['account:roles:read', 'organization:structure:read', 'account:users:read']);
      const owner = await tx.organization.findUnique({ where: { id: scope }, select: { type: true } });
      if (owner?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    }
    if (source.mappings.some(mapping => mapping.isCanonical)) adminError('FEATURE_PERMISSION_DENIED', 403);
    if (input.directUserIds.some(id => !source.direct.some(row => row.userId === id && row.organizationId === organizationId))
      || input.sourcePositionIds.some(id => !source.mappings.some(row => row.positionId === id && row.organizationId === organizationId))) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    const positionIds = [...new Set([...source.mappings.map(row => row.positionId), ...(input.targetPositionId ? [input.targetPositionId] : [])])].sort();
    const positions = await tx.position.findMany({ where: { id: { in: positionIds } }, select: positionSelect, orderBy: { id: 'asc' } });
    const assignments = await tx.userPosition.findMany({ where: { positionId: { in: positionIds } }, select: { id: true, organizationId: true, userId: true, positionId: true, startedAt: true, endedAt: true }, orderBy: { id: 'asc' } });
    const userIds = [...new Set([...source.direct.map(row => row.userId), ...assignments.map(row => row.userId), actor.id])].sort();
    const target = input.targetPositionId ? positions.find(row => row.id === input.targetPositionId && row.organizationId === organizationId) : undefined;
    const departmentId = input.newPosition?.departmentId ?? target?.departmentId ?? null;
    if (input.targetPositionId && (!target || target.status !== 'ACTIVE' || target.deletedAt || target.configurationRequired
      || (target.departmentId !== null && (!target.department || target.department.status !== 'ACTIVE' || target.department.deletedAt || target.department.configurationRequired)))) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    let newDepartment = null;
    if (input.newPosition?.departmentId) {
      newDepartment = await tx.department.findFirst({ where: { id: input.newPosition.departmentId, organizationId, status: 'ACTIVE', deletedAt: null, configurationRequired: false }, select: { id: true, version: true } });
      if (!newDepartment) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    }
    if (input.newPosition?.categoryId && !await tx.positionCategory.findFirst({ where: { id: input.newPosition.categoryId, organizationId, status: 'ACTIVE' } })) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    const users = await this.identities.snapshot(tx, userIds, organizationId);
    for (const home of [...new Set(users.map(user => user.organizationId))].filter(id => !scopes.includes(id))) {
      await assertAdminAccess(tx, actor, home, ['account:users:read', 'organization:structure:read']);
    }
    const userAppointments = await tx.userPosition.findMany({ where: { userId: { in: userIds }, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] },
      select: { id: true, userId: true, organizationId: true, positionId: true, startedAt: true, endedAt: true, position: { select: positionSelect } }, orderBy: { id: 'asc' } });
    const lockPositions = [...new Map([...positions, ...userAppointments.map(row => row.position)].map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
    const relatedRoles = await this.roles.roles(tx, [...new Set(lockPositions.flatMap(row => row.roles.map(mapping => mapping.roleId)))]);
    const references = await this.workflows.references(tx, scopes, source.role.code);
    const canonicalId = target?.roles.find(row => row.isCanonical)?.roleId;
    const canonical = canonicalId ? (await this.roles.roles(tx, [canonicalId]))[0] : undefined;
    if (canonicalId && !canonical) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    const retained = source.direct.filter(row => row.organizationId !== organizationId || !input.directUserIds.includes(row.userId)).length
      + source.mappings.filter(row => row.organizationId !== organizationId || !input.sourcePositionIds.includes(row.positionId)).length;
    const strategy = input.operation === 'REMOVE' ? 'REMOVE' : source.role.organizationId === null && retained > 0 && input.newPosition && input.preserveRoleCode ? 'INDEPENDENT_CANONICAL'
      : !canonical && retained === 0 ? 'ADOPT' : input.preserveRoleCode ? 'MERGE_WITH_QUALIFICATION' : 'MERGE';
    if (input.operation === 'MIGRATE' && strategy !== 'ADOPT' && (references.length || source.role.code === 'QMS_ADMIN') && !input.preserveRoleCode) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    if (source.role.organizationId === null && input.operation === 'MIGRATE') {
      if (strategy !== 'INDEPENDENT_CANONICAL' && (strategy !== 'ADOPT' || source.direct.some(row => row.organizationId !== organizationId) || source.mappings.length)) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      if (strategy === 'INDEPENDENT_CANONICAL' && await this.roles.scopedCodeExists(tx, organizationId, source.role.code)) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    }
    const selectedUsers = [...new Set([...input.directUserIds, ...assignments.filter(row => input.sourcePositionIds.includes(row.positionId) && (!row.endedAt || row.endedAt > new Date())).map(row => row.userId)])];
    if (users.some(user => selectedUsers.includes(user.id) && user.accountType !== 'INTERNAL')
      || (input.operation === 'MIGRATE' && users.some(user => selectedUsers.includes(user.id) && (user.organizationId !== organizationId || user.deletedAt || user.configurationRequired)))) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const now = new Date();
    const temporal = (assignment: typeof assignments[number]) => {
      if (assignment.endedAt && assignment.endedAt <= now) return 'ENDED';
      const position = lockPositions.find(row => row.id === assignment.positionId);
      const user = users.find(row => row.id === assignment.userId);
      if (!position || position.status !== 'ACTIVE' || position.deletedAt || position.configurationRequired
        || (position.departmentId !== null && (!position.department || position.department.status !== 'ACTIVE' || position.department.deletedAt || position.department.configurationRequired))
        || !user || user.organizationId !== assignment.organizationId || user.status !== 'ACTIVE' || user.deletedAt || user.configurationRequired || user.organization.status !== 'ACTIVE') return 'UNAVAILABLE';
      return assignment.startedAt > now ? 'FUTURE' : 'CURRENT';
    };
    const permissionCodes = [...new Set([...(canonical?.permissionCodes ?? []), ...source.role.permissionCodes])].sort();
    const impactIds = [...new Set([...selectedUsers, ...assignments.filter(row => row.positionId === target?.id && (!row.endedAt || row.endedAt > now)).map(row => row.userId)])].sort();
    const prospectivePositionId = target?.id ?? stableId(`legacy-position:${organizationId}:${roleId}:${input.newPosition?.code}`);
    const prospectiveRoleId = canonical?.id ?? (strategy === 'ADOPT' ? source.role.id : stableId(`legacy-canonical:${prospectivePositionId}`));
    const affectedUsers = [];
    for (const user of users.filter(user => impactIds.includes(user.id))) {
      const before = [...new Set(user.grants.flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code)))].sort();
      const candidates: EffectiveRoleGrant[] = user.rawGrants.flatMap(grant => {
        const runtimeSources = grant.sources.filter(row => row.kind === 'DIRECT' || (user.status === 'ACTIVE' && !user.deletedAt && !user.configurationRequired));
        if (grant.organizationId !== organizationId) return runtimeSources.length ? [{ ...grant, sources: runtimeSources }] : [];
        const sources = grant.role.id !== roleId ? runtimeSources : runtimeSources.filter(row => row.kind === 'DIRECT' ? !input.directUserIds.includes(user.id) : !input.sourcePositionIds.includes(row.positionId));
        if (!sources.length) return [];
        const changesCanonical = input.operation === 'MIGRATE' && grant.role.id === canonicalId;
        return [{ ...grant, sources, role: changesCanonical ? { ...grant.role, mfaRequired: !!canonical?.mfaRequired || source.role.mfaRequired, permissions: permissionCodes.map(code => ({ permission: { id: code, code, name: code } })) } : grant.role }];
      });
      const receives = input.operation === 'MIGRATE' && (input.directUserIds.includes(user.id)
        || assignments.some(row => row.userId === user.id && (input.sourcePositionIds.includes(row.positionId) || row.positionId === target?.id) && temporal(row) === 'CURRENT'));
      if (receives && user.organizationId === organizationId && user.status === 'ACTIVE' && !user.deletedAt && !user.configurationRequired) {
        const definition = { id: prospectiveRoleId, organizationId, code: canonical?.code ?? (['ADOPT', 'INDEPENDENT_CANONICAL'].includes(strategy) ? source.role.code : `POS_${prospectiveRoleId}`), name: canonical?.name ?? input.newPosition?.name ?? target!.name,
          mfaRequired: !!canonical?.mfaRequired || source.role.mfaRequired, permissions: permissionCodes.map(code => ({ permission: { id: code, code, name: code } })) };
        candidates.push({ organizationId, role: definition, sources: [{ kind: 'POSITION', positionId: prospectivePositionId, assignmentId: 'prospective' }] });
        if (strategy === 'MERGE_WITH_QUALIFICATION') candidates.push({ organizationId, role: { ...definition, id: roleId, code: source.role.code, mfaRequired: source.role.mfaRequired, permissions: source.role.permissionCodes.map(code => ({ permission: { id: code, code, name: code } })) }, sources: [{ kind: 'POSITION', positionId: prospectivePositionId, assignmentId: 'prospective' }] });
      }
      const globalAfter = await projectEffectiveRoleGrants(tx, user, candidates);
      const after = globalAfter.filter(grant => grant.organizationId === organizationId);
      const afterMfaRequired = effectiveMfa(globalAfter.some(grant => grant.role.permissions.some(({ permission }) => isGovernancePermission(permission.code))), user.mfaPreference, globalAfter.some(grant => grant.role.mfaRequired), user.mfaEnabled, user.mfaRequirementOverride);
      affectedUsers.push({ userId: user.id, organizationId: user.organizationId, securityVersion: user.securityVersion, status: user.status, accountType: user.accountType, mfaEnabled: user.mfaEnabled,
        beforePermissionCodes: before, afterPermissionCodes: [...new Set(after.flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code)))].sort(), beforeRoleCodes: [...new Set(user.grants.map(grant => grant.role.code))].sort(), afterRoleCodes: [...new Set(after.map(grant => grant.role.code))].sort(),
        beforeMfaRequired: user.effectiveMfaRequired, afterMfaRequired, beforePlatformAdministrator: user.platformAdministrator, afterPlatformAdministrator: globalAfter.some(grant => !!grant.platformScope),
        appointments: userAppointments.filter(row => row.userId === user.id).map(({ position: _position, ...row }) => ({ ...row, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null, temporalState: temporal(row) })) });
    }
    const labelScopes = [...new Set([...scopes, ...users.map(user => user.organizationId)])].sort();
    const labels = {
      users: users.map(user => ({ id: user.id, organizationId: user.organizationId, username: user.username, fullName: user.fullName, status: user.status, unavailable: !!user.deletedAt || user.configurationRequired })),
      positions: positions.map(position => ({ id: position.id, organizationId: position.organizationId, departmentId: position.departmentId, department: position.department ? { id: position.department.id, code: position.department.code, name: position.department.name } : null, code: position.code, name: position.name, status: position.status, version: position.version, roleVersion: position.roleVersion, unavailable: !!position.deletedAt || position.configurationRequired })),
      organizations: await tx.organization.findMany({ where: { id: { in: labelScopes } }, select: { id: true, code: true, name: true }, orderBy: { id: 'asc' } }),
    };
    const preview = { authorizationBaseline: '', role: source.role, labels,
      directSources: source.direct.map(row => ({ ...row, selected: row.organizationId === organizationId && input.directUserIds.includes(row.userId), initialization: source.initialization.some(origin => origin.organizationId === row.organizationId && origin.userId === row.userId && origin.roleId === row.roleId) })),
      mappedSources: source.mappings.map(row => ({ ...row, selected: row.organizationId === organizationId && input.sourcePositionIds.includes(row.positionId), assignments: assignments.filter(assignment => assignment.positionId === row.positionId).map(assignment => ({ ...assignment, startedAt: assignment.startedAt.toISOString(), endedAt: assignment.endedAt?.toISOString() ?? null, temporalState: temporal(assignment) })) })),
      target: input.operation === 'REMOVE' ? null : { positionId: prospectivePositionId, canonicalRoleId: prospectiveRoleId, roleCode: canonical?.code ?? (['ADOPT', 'INDEPENDENT_CANONICAL'].includes(strategy) ? source.role.code : `POS_${prospectiveRoleId}`), departmentId, code: target?.code ?? input.newPosition!.code, name: target?.name ?? input.newPosition!.name, originalCanonical: canonical ?? null, strategy, permissionCodes, mfaRequired: !!canonical?.mfaRequired || source.role.mfaRequired },
      workflowReferences: references, affectedUsers, impactUserIds: impactIds, retainedSourceCount: retained };
    const baseline = { purpose: 'legacy-authorization:v1', actorId: actor.id, actorHome: actor.organizationId, scope: organizationId, input, organization, source, positions: lockPositions, relatedRoles, userAppointments: userAppointments.map(row => ({ ...row, temporalState: temporal(row) })), assignments: assignments.map(row => ({ ...row, temporalState: temporal(row) })), users, newDepartment, preview };
    const digests = adminMutationDigests(JSON.stringify(baseline), process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production');
    preview.authorizationBaseline = digests[0]!;
    return { preview, digests, source, positions, assignments, users, target, strategy, canonical, now, organization, lockPositions };
  }
}
