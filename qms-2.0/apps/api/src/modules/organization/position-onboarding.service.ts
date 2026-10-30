import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { adminMutationDigests } from '../../common/security/security-keyring.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { effectivePositionAssignmentWhere, projectEffectiveRoleGrants, roleGrantSources, type EffectiveRoleGrant } from '../../common/security/effective-role-grants.js';
import { assertPositionRoleCeiling, assertPositionRolesGrantable, positionRoleDefinitions } from '../../common/security/position-role-policy.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { PositionAuthorizationPreviewInputDto } from './position-onboarding.dto.js';

export type InitialPositionsInput = { positionIds: string[]; authorizationBaseline: string };

export class PositionGrantCeilingDenied extends HttpException {
  constructor() { super({ code: 'POSITION_GRANT_CEILING_DENIED', message: '所选岗位包含无权授予的权限' }, 403); }
}

@Injectable()
export class PositionOnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  preview(actor: AdminActor, organizationId: string, input: PositionAuthorizationPreviewInputDto) {
    return this.prisma.$transaction(async (tx) => (await this.snapshot(tx, actor, organizationId, input, false)).preview, { isolationLevel: 'RepeatableRead' });
  }

  async summariesForUsers(tx: AdminTransaction, organizationId: string, userIds: string[]) {
    if (userIds.length > 100) throw new BadRequestException('At most 100 users per position summary query');
    if (!userIds.length) return [];
    const effective = effectivePositionAssignmentWhere();
    const users = await tx.user.findMany({ where: { organizationId, id: { in: userIds } }, select: {
      id: true,
      positions: { where: effective, take: 3, orderBy: [{ positionId: 'asc' }, { id: 'asc' }], select: { position: { select: { id: true, code: true, name: true, department: { select: { id: true, code: true, name: true } } } } } },
      _count: { select: { positions: { where: effective } } },
    } });
    return users.map(({ id: userId, positions, _count }) => ({ userId, positions: positions.map(({ position }) => position), totalPositions: _count.positions }));
  }

  // Replays recheck authorization, but never recreate appointments or consume a new preview.
  async authorizeInitialPositions(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: InitialPositionsInput) {
    this.validate(input.positionIds, true);
    if (typeof input.authorizationBaseline !== 'string' || !input.authorizationBaseline.length || input.authorizationBaseline.length > 256) throw new BadRequestException('Invalid authorization baseline');
    await this.snapshot(tx, actor, organizationId, input, true);
  }

  async createWithInitialPositions<T extends { id: string }>(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: InitialPositionsInput, traceId: string, createUser: () => Promise<T>): Promise<T> {
    this.validate(input.positionIds, true);
    const snapshot = await this.snapshot(tx, actor, organizationId, input, true);
    if (!snapshot.digests.includes(input.authorizationBaseline)) adminError('CONCURRENCY_CONFLICT', 409);
    const user = await createUser();
    await tx.userPosition.createMany({ data: snapshot.preview.positions.map(({ id: positionId }) => ({ organizationId, userId: user.id, positionId, startedAt: new Date() })) });
    await this.audit.record({ actorUserId: actor.id, organizationId, action: 'USER_POSITIONS_REPLACED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId, metadata: { targetUserId: user.id, resourceVersion: 1 } }, tx);
    return user;
  }

  async verifyAdjustment(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: InitialPositionsInput & { targetUserId: string }) {
    const snapshot = await this.snapshot(tx, actor, organizationId, input, true);
    if (!snapshot.digests.includes(input.authorizationBaseline)) adminError('CONCURRENCY_CONFLICT', 409);
  }

  async authorizeAdjustment(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: InitialPositionsInput & { targetUserId: string }) {
    await this.snapshot(tx, actor, organizationId, input, true);
  }

  private validate(positionIds: string[], required = false) {
    if (!Array.isArray(positionIds) || positionIds.length > 100 || (required && !positionIds.length) || new Set(positionIds).size !== positionIds.length || positionIds.some((id) => typeof id !== 'string' || !isUUID(id))) throw new BadRequestException('Invalid initial positions');
  }

  private async snapshot(tx: AdminTransaction, actor: AdminActor, organizationId: string, input: PositionAuthorizationPreviewInputDto, lock: boolean) {
    this.validate(input.positionIds);
    const ids = [...input.positionIds].sort();
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    if (lock) await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    let positions = await this.positions(tx, organizationId, ids);
    if (positions.length !== ids.length) adminError('STRUCTURE_NOT_FOUND', 404);
    if (lock && ids.length) {
      const ownership = new Map(positions.map(({ id, departmentId }) => [id, departmentId]));
      const departmentIds = [...new Set(positions.map(({ departmentId }) => departmentId).filter((id): id is string => id !== null))].sort();
      if (departmentIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(departmentIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM positions WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
      positions = await this.positions(tx, organizationId, ids);
      if (positions.length !== ids.length || positions.some(({ id, departmentId }) => ownership.get(id) !== departmentId)) adminError('CONCURRENCY_CONFLICT', 409);
    }
    const roleIds = positions.flatMap(({ roles }) => roles.map(({ roleId }) => roleId));
    const roles = await positionRoleDefinitions(tx, organizationId, roleIds, lock);
    if (lock) await assertRecentAuthentication(tx, actor);
    const granted = await assertAdminAccess(tx, actor, organizationId, ['organization:structure:read', 'organization:positions:assign', ...(roles.length ? ['account:roles:read', 'account:roles:assign'] : [])]);
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, status: true, version: true, type: true, deletedAt: true, configurationRequired: true } });
    if (organization.type !== 'INTERNAL') adminError('ORGANIZATION_TYPE_MISMATCH', 409);
    if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired
      || positions.some((position) => position.status !== 'ACTIVE' || position.deletedAt || position.configurationRequired
        || (position.departmentId !== null && (!position.department || position.department.status !== 'ACTIVE' || position.department.deletedAt || position.department.configurationRequired)))) adminError('STRUCTURE_DISABLED', 409);
    assertPositionRolesGrantable(roles);
    try {
      assertPositionRoleCeiling(roles, granted, organization.type);
    } catch (error) {
      // Only a row-specific ceiling denial is recoverable; actor authorization above must still stop a batch.
      if (error instanceof HttpException && error.getStatus() === 403) throw new PositionGrantCeilingDenied();
      throw error;
    }
    const source = (role: (typeof roles)[number]) => ({ roleId: role.id, roleCode: role.code, name: role.name, permissionCodes: role.permissions.map(({ code }) => code).sort(), mfaRequired: role.mfaRequired });
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    const items = positions.map((position) => {
      const own = position.roles.find(({ isCanonical }) => isCanonical);
      const role = own ? roleMap.get(own.roleId)! : undefined;
      return { id: position.id, code: position.code, name: position.name, department: position.department ? { id: position.department.id, code: position.department.code, name: position.department.name } : null, version: position.version, roleVersion: position.roleVersion, permissionCodes: role?.permissions.map(({ code }) => code).sort() ?? [], mfaRequired: role?.mfaRequired ?? false, historicalSources: position.roles.filter(({ isCanonical }) => !isCanonical).map(({ roleId }) => source(roleMap.get(roleId)!)) };
    });
    let targetContext: unknown = null;
    let retainedGrants: EffectiveRoleGrant[] = [];
    let subject = { status: 'ACTIVE', accountType: 'INTERNAL', organization };
    if (input.targetUserId) {
      await assertAdminAccess(tx, actor, organizationId, 'account:users:read');
      if (lock) await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.targetUserId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      const target = await tx.user.findFirst({ where: { id: input.targetUserId, organizationId }, select: { id: true, status: true, securityVersion: true, accountType: true, mfaEnabled: true, mfaPreference: true, mfaRequirementOverride: true } });
      if (!target) adminError('ADMIN_USER_NOT_FOUND', 404);
      const grants = await roleGrantSources(tx, target.id);
      retainedGrants = grants.filter(({ sources }) => sources.some(({ kind }) => kind === 'DIRECT')).map(grant => ({ ...grant, sources: [{ kind: 'DIRECT' }] }));
      subject = { ...target, organization };
      const assignments = await tx.userPosition.findMany({ where: { userId: target.id, organizationId }, select: { id: true, positionId: true, startedAt: true, endedAt: true }, orderBy: { id: 'asc' } });
      targetContext = { target, assignments, grants };
    }
    const candidates: EffectiveRoleGrant[] = [...retainedGrants, ...roles.map(role => ({ organizationId, role: { ...role, permissions: role.permissions.map(permission => ({ permission })) }, sources: [] }))];
    const projected = await projectEffectiveRoleGrants(tx, subject, candidates, organizationId);
    const retainedSources = input.targetUserId ? retainedGrants.flatMap(grant => {
      const platformScope = projected.find(item => item.role.id === grant.role.id && item.platformScope?.sourceOrganizationIds.includes(grant.organizationId))?.platformScope;
      return grant.organizationId === organizationId || platformScope ? [{ ...source({ ...grant.role, permissions: grant.role.permissions.map(({ permission }) => permission) }), organizationId: grant.organizationId, ...(platformScope ? { platformScope } : {}) }] : [];
    }) : undefined;
    const codes = [...new Set(projected.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))].sort();
    const baseline = JSON.stringify({ purpose: 'position-authorization-preview:v1', actorId: actor.id, organization, positionIds: ids, positions, roles, targetUserId: input.targetUserId ?? null, targetContext, projected });
    const digests = adminMutationDigests(baseline, process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production');
    return { digests, preview: { authorizationBaseline: digests[0]!, positions: items, effectivePermissionCodes: codes, effectiveMfaRequired: projected.some(({ role }) => role.mfaRequired), ...(retainedSources === undefined ? {} : { retainedSources }) } };
  }

  private positions(tx: AdminTransaction, organizationId: string, ids: string[]) {
    return tx.position.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, departmentId: true, code: true, name: true, status: true, deletedAt: true, configurationRequired: true, version: true, roleVersion: true, department: { select: { id: true, code: true, name: true, status: true, deletedAt: true, configurationRequired: true, version: true } }, roles: { select: { roleId: true, isCanonical: true }, orderBy: { roleId: 'asc' } } }, orderBy: { id: 'asc' } });
  }
}
