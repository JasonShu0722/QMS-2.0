import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ADMIN_PERMISSIONS, AdminMutationService, adminError, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { grantSupplierBoundaryCaretaker } from '../authorization/supplier-account-authorization.js';
import { effectivePositionAssignmentWhere, effectiveRoleGrants } from '../../common/security/effective-role-grants.js';
import { assertPositionRoleCeiling, assertPositionRolesGrantable, positionRoleDefinitions } from '../../common/security/position-role-policy.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import type { CreateOrganizationDto, UpdateOrganizationDto, OrganizationListQueryDto, CreateDepartmentDto, UpdateDepartmentDto, CreatePositionDto, UpdatePositionDto, ReplacePositionRolesDto, ReplaceUserPositionsDto } from './organization.dto.js';

const governancePermissions = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];
const organizationSelect = { id: true, code: true, name: true, type: true, parentId: true, status: true, version: true } as const;
const departmentSelect = { id: true, organizationId: true, code: true, name: true, parentId: true, status: true, version: true } as const;
const positionSelect = { id: true, organizationId: true, code: true, name: true, departmentId: true, categoryId: true, status: true, version: true } as const;
type PositionRolePolicy = { positionIds: string[]; roles: Awaited<ReturnType<typeof positionRoleDefinitions>>; grantableRoles: Awaited<ReturnType<typeof positionRoleDefinitions>> };

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  lookup(id: string, transaction: Prisma.TransactionClient = this.prisma) {
    return transaction.organization.findUnique({ where: { id }, select: { id: true, name: true, code: true, type: true } });
  }

  async currentAssignments(userId: string, organizationId: string, now = new Date(), transaction: Prisma.TransactionClient = this.prisma) {
    const assignments = await transaction.userPosition.findMany({
      where: { userId, organizationId, user: { organizationId, status: 'ACTIVE' }, ...effectivePositionAssignmentWhere(now) },
      select: { id: true, startedAt: true, endedAt: true, position: { select: { id: true, code: true, name: true, department: { select: { id: true, code: true, name: true } } } } },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    return assignments.map(({ position: { department, ...position }, ...assignment }) => ({
      ...assignment, startedAt: assignment.startedAt.toISOString(), endedAt: assignment.endedAt?.toISOString() ?? null, position, department,
    }));
  }

  async createSupplierBoundary(transaction: AdminTransaction, actor: AdminActor, ownerOrganizationId: string, name: string, traceId: string) {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(transaction, actor, ownerOrganizationId, ['supplier-quality:profiles:write', 'account:users:create']);
    const owner = await this.lookup(ownerOrganizationId, transaction);
    if (owner?.type !== 'INTERNAL' || !name.trim() || name.trim().length > 200) adminError('SUPPLIER_INPUT_INVALID', 400);
    const organization = await transaction.organization.create({ data: { code: `SUP-${randomUUID()}`, name: name.trim(), type: 'SUPPLIER' }, select: organizationSelect });
    await grantSupplierBoundaryCaretaker(transaction, actor, ownerOrganizationId, organization.id);
    await this.record(transaction, actor, organization.id, 'SUPPLIER_BOUNDARY_CREATED', 'Organization', organization.id, traceId, organization.version);
    return organization;
  }

  async supplierDirectory(query: { search?: string; selectedId?: string; page: number; pageSize: number }, transaction: Prisma.TransactionClient = this.prisma) {
    const where: Prisma.OrganizationWhereInput = { type: 'SUPPLIER', ...(query.selectedId ? { id: query.selectedId } : { OR: [{ name: { contains: query.search ?? '', mode: 'insensitive' } }, { code: { contains: query.search ?? '', mode: 'insensitive' } }] }) };
    const [items, total] = await Promise.all([
      transaction.organization.findMany({ where, select: { id: true, name: true, code: true }, orderBy: [{ code: 'asc' }, { id: 'asc' }], skip: query.selectedId ? 0 : (query.page - 1) * query.pageSize, take: query.pageSize }),
      transaction.organization.count({ where }),
    ]);
    return { items, total };
  }

  async current(userId: string, organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: organizationSelect,
    });
    return { organization, userId };
  }

  async tree(actor: AdminActor, query: OrganizationListQueryDto) {
    await assertAdminAccess(this.prisma, actor, query.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId, 'organization:read');
    const grants = await effectiveRoleGrants(this.prisma, actor.id, actor.accountType === 'SUPPLIER' ? actor.organizationId : undefined);
    const readable = grants.filter(({ role }) => role.permissions.some(({ permission }) => permission.code === 'organization:read')).map(({ organizationId }) => organizationId);
    const manageable = grants.filter(({ role }) => role.permissions.some(({ permission }) => permission.code === 'organization:manage')).map(({ organizationId }) => organizationId);
    return this.prisma.organization.findMany({
      where: {
        id: { in: readable },
        OR: [
          { status: 'ACTIVE' },
          { id: { in: manageable } },
        ],
      },
      select: organizationSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0,
    });
  }

  createChild(actor: AdminActor, parentId: string, dto: CreateOrganizationDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId: parentId, key, action: 'ORGANIZATION_CREATED', payload: { parentId, ...dto }, permission: ['organization:manage', 'organization:read'], traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction, granted) => {
      if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
      const parent = await this.activeOrganization(transaction, parentId);
      const child = await transaction.organization.create({ data: { parentId, code: dto.code, name: dto.name.trim(), type: parent.type }, select: organizationSelect });
      const permissions = await transaction.permission.findMany({ where: { code: { in: governancePermissions.filter((code) => granted.includes(code)) } } });
      const role = await transaction.role.create({ data: { organizationId: child.id, code: 'ORGANIZATION_GOVERNOR', name: '组织治理', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
      await transaction.userRole.create({ data: { userId: actor.id, roleId: role.id, organizationId: child.id } });
      await this.record(transaction, actor, child.id, 'ORGANIZATION_CREATED', 'Organization', child.id, traceId, child.version);
      return child;
    });
  }

  update(actor: AdminActor, organizationId: string, dto: UpdateOrganizationDto, traceId: string, key?: string) {
    if (dto.parentId && dto.expectedParentId === undefined) adminError('CONCURRENCY_CONFLICT', 409);
    const additionalAccess = dto.parentId
      ? [...new Set([dto.parentId, dto.expectedParentId].filter((parentId): parentId is string => typeof parentId === 'string'))].map((parentId) => ({ organizationId: parentId, permission: 'organization:manage' }))
      : [];
    return this.mutations.run({ actor, organizationId, key, action: 'ORGANIZATION_UPDATED', payload: { organizationId, ...dto }, permission: 'organization:manage', additionalAccess, traceId }, async (transaction) => {
      const current = await transaction.organization.findUnique({ where: { id: organizationId } });
      if (!current) adminError('ORGANIZATION_NOT_FOUND', 404);
      if (dto.status === 'DISABLED' && organizationId === actor.organizationId) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
      if (dto.parentId) {
        if (dto.expectedParentId !== current.parentId) adminError('CONCURRENCY_CONFLICT', 409);
        const parent = await this.activeOrganization(transaction, dto.parentId);
        if (parent.type !== current.type) adminError('ORGANIZATION_TYPE_MISMATCH', 409);
        await this.noCycle(transaction, organizationId, dto.parentId);
      }
      const changed = await transaction.organization.updateMany({ where: { id: organizationId, version: dto.expectedVersion, ...(dto.parentId ? { parentId: dto.expectedParentId } : {}) }, data: { name: dto.name?.trim(), parentId: dto.parentId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      if (dto.status === 'DISABLED') {
        await transaction.session.updateMany({ where: { user: { organizationId }, revokedAt: null }, data: { revokedAt: new Date() } });
        await transaction.mfaChallenge.updateMany({ where: { user: { organizationId }, consumedAt: null }, data: { consumedAt: new Date() } });
      }
      const result = await transaction.organization.findUniqueOrThrow({ where: { id: organizationId }, select: organizationSelect });
      await this.record(transaction, actor, organizationId, 'ORGANIZATION_UPDATED', 'Organization', organizationId, traceId, result.version);
      return result;
    });
  }

  async departments(organizationId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    return this.prisma.department.findMany({ where: { organizationId }, select: departmentSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
  }

  createDepartment(actor: AdminActor, organizationId: string, dto: CreateDepartmentDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'DEPARTMENT_CREATED', payload: { organizationId, ...dto }, permission: 'organization:structure:manage', traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await this.activeOrganization(transaction, organizationId);
      if (dto.parentId) await this.activeDepartment(transaction, organizationId, dto.parentId);
      const result = await transaction.department.create({ data: { ...dto, name: dto.name.trim(), organizationId }, select: departmentSelect });
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_CREATED', 'Department', result.id, traceId, result.version);
      return result;
    });
  }

  updateDepartment(actor: AdminActor, organizationId: string, departmentId: string, dto: UpdateDepartmentDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'DEPARTMENT_UPDATED', payload: { organizationId, departmentId, ...dto }, permission: 'organization:structure:manage', traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${departmentId}::uuid FOR UPDATE`;
      await this.activeOrganization(transaction, organizationId);
      const current = await transaction.department.findFirst({ where: { organizationId, id: departmentId } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (dto.parentId) {
        await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${dto.parentId}::uuid FOR SHARE`;
        await this.activeDepartment(transaction, organizationId, dto.parentId);
        await this.noCycle(transaction, departmentId, dto.parentId, organizationId);
      }
      const positionIds = dto.status !== undefined && dto.status !== current.status
        ? (await transaction.position.findMany({ where: { organizationId, departmentId, status: 'ACTIVE' }, select: { id: true } })).map(({ id }) => id) : [];
      await this.lockPositions(transaction, organizationId, positionIds);
      const policy = await this.lockPositionRoles(transaction, organizationId, positionIds, dto.status === 'ACTIVE' ? positionIds : []);
      await this.lockPositionAssignees(transaction, organizationId, policy.positionIds);
      const granted = await this.refreshPositionAccess(transaction, actor, organizationId, ['organization:structure:manage'], policy);
      const now = new Date();
      const before = await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now);
      const changed = await transaction.department.updateMany({ where: { organizationId, id: departmentId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), parentId: dto.parentId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const after = await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now);
      await this.invalidatePositionUsers(transaction, actor, organizationId, [...before, ...after], granted);
      const result = await transaction.department.findUniqueOrThrow({ where: { id: departmentId }, select: departmentSelect });
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_UPDATED', 'Department', departmentId, traceId, result.version);
      return result;
    });
  }

  async positions(organizationId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    return this.prisma.position.findMany({ where: { organizationId }, select: positionSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
  }

  async positionRoles(actor: AdminActor, organizationId: string, positionId: string) {
    await assertAdminAccess(this.prisma, actor, organizationId, ['organization:structure:read', 'account:roles:read']);
    return this.positionRoleResult(this.prisma, organizationId, positionId);
  }

  replacePositionRoles(actor: AdminActor, organizationId: string, positionId: string, dto: ReplacePositionRolesDto, traceId: string, key?: string) {
    const roleIds = [...new Set(dto.roleIds)].sort();
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_ROLES_CHANGED', payload: { organizationId, positionId, roleIds, expectedRoleVersion: dto.expectedRoleVersion }, permission: ['organization:structure:manage', 'account:roles:read', 'account:roles:assign'], traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.lockPositions(transaction, organizationId, [positionId]);
      const current = await transaction.position.findFirst({ where: { organizationId, id: positionId }, select: { roleVersion: true, roles: { select: { roleId: true } } } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (current.roleVersion >= 2147483647) adminError('CONCURRENCY_CONFLICT', 409);
      const previous = current.roles.map(({ roleId }) => roleId).sort();
      const roles = await positionRoleDefinitions(transaction, organizationId, [...previous, ...roleIds], true);
      const mappingChanged = JSON.stringify(previous) !== JSON.stringify(roleIds);
      if (mappingChanged) await this.lockPositionAssignees(transaction, organizationId, [positionId]);
      const policy = { positionIds: [positionId], roles, grantableRoles: roles.filter(({ id }) => roleIds.includes(id) && !previous.includes(id)) };
      const granted = await this.refreshPositionAccess(transaction, actor, organizationId, ['organization:structure:manage', 'account:roles:read', 'account:roles:assign'], policy);
      const changed = await transaction.position.updateMany({ where: { organizationId, id: positionId, roleVersion: dto.expectedRoleVersion }, data: { roleVersion: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const affected = mappingChanged ? await this.effectivePositionUsers(transaction, organizationId, [positionId]) : [];
      if (mappingChanged) {
        await transaction.positionRole.deleteMany({ where: { organizationId, positionId } });
        if (roleIds.length) await transaction.positionRole.createMany({ data: roleIds.map((roleId) => ({ organizationId, positionId, roleId })) });
      }
      const selfSessionRevoked = await this.invalidatePositionUsers(transaction, actor, organizationId, affected, granted);
      await this.record(transaction, actor, organizationId, 'POSITION_ROLES_CHANGED', 'Position', positionId, traceId, dto.expectedRoleVersion + 1);
      return this.positionRoleResult(transaction, organizationId, positionId, selfSessionRevoked);
    });
  }

  createPosition(actor: AdminActor, organizationId: string, dto: CreatePositionDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_CREATED', payload: { organizationId, ...dto }, permission: 'organization:structure:manage', traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await this.activeOrganization(transaction, organizationId);
      await this.activeDepartment(transaction, organizationId, dto.departmentId);
      if (dto.categoryId) await this.activeCategory(transaction, organizationId, dto.categoryId);
      const result = await transaction.position.create({ data: { ...dto, name: dto.name.trim(), organizationId }, select: positionSelect });
      await this.record(transaction, actor, organizationId, 'POSITION_CREATED', 'Position', result.id, traceId, result.version);
      return result;
    });
  }

  updatePosition(actor: AdminActor, organizationId: string, positionId: string, dto: UpdatePositionDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_UPDATED', payload: { organizationId, positionId, ...dto }, permission: 'organization:structure:manage', traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.activeOrganization(transaction, organizationId);
      const beforeLock = await transaction.position.findFirst({ where: { organizationId, id: positionId }, include: { department: { select: { status: true } } } });
      if (!beforeLock) adminError('STRUCTURE_NOT_FOUND', 404);
      const departmentIds = [...new Set([beforeLock.departmentId, dto.departmentId ?? beforeLock.departmentId])].sort();
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(departmentIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      await this.lockPositions(transaction, organizationId, [positionId]);
      const current = await transaction.position.findFirst({ where: { organizationId, id: positionId }, include: { department: { select: { status: true } } } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (dto.categoryId) await transaction.$queryRaw`SELECT id FROM position_categories WHERE organization_id = ${organizationId}::uuid AND id = ${dto.categoryId}::uuid FOR SHARE`;
      if (dto.departmentId || dto.status === 'ACTIVE') await this.activeDepartment(transaction, organizationId, dto.departmentId ?? current.departmentId);
      if (dto.categoryId) await this.activeCategory(transaction, organizationId, dto.categoryId);
      else if (dto.status === 'ACTIVE' && dto.categoryId !== null && current.categoryId) await this.activeCategory(transaction, organizationId, current.categoryId);
      const authorizationChanged = (dto.status !== undefined && dto.status !== current.status) || (dto.departmentId !== undefined && dto.departmentId !== current.departmentId);
      const gainsAuthorization = (dto.status ?? current.status) === 'ACTIVE' && (current.status !== 'ACTIVE' || current.department.status !== 'ACTIVE');
      const policy = await this.lockPositionRoles(transaction, organizationId, authorizationChanged ? [positionId] : [], gainsAuthorization ? [positionId] : []);
      await this.lockPositionAssignees(transaction, organizationId, policy.positionIds);
      const granted = await this.refreshPositionAccess(transaction, actor, organizationId, ['organization:structure:manage'], policy);
      const now = new Date();
      const before = await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now);
      const changed = await transaction.position.updateMany({ where: { organizationId, id: positionId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), departmentId: dto.departmentId, categoryId: dto.categoryId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const after = await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now);
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      const affected = before.filter((id) => !afterSet.has(id)).concat(after.filter((id) => !beforeSet.has(id)));
      await this.invalidatePositionUsers(transaction, actor, organizationId, affected, granted);
      const result = await transaction.position.findUniqueOrThrow({ where: { id: positionId }, select: positionSelect });
      await this.record(transaction, actor, organizationId, 'POSITION_UPDATED', 'Position', positionId, traceId, result.version);
      return result;
    });
  }

  async userPositions(organizationId: string, userId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) adminError('STRUCTURE_NOT_FOUND', 404);
    return this.prisma.userPosition.findMany({ where: { organizationId, userId }, include: { position: { select: positionSelect } }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
  }

  replaceUserPositions(actor: AdminActor, organizationId: string, userId: string, dto: ReplaceUserPositionsDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'USER_POSITIONS_REPLACED', payload: { organizationId, userId, ...dto }, permission: 'organization:positions:assign', traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.activeOrganization(transaction, organizationId);
      const user = await transaction.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' } });
      if (!user) adminError('STRUCTURE_NOT_FOUND', 404);
      const candidates = await transaction.userPosition.findMany({ where: { organizationId, userId, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] }, select: { positionId: true } });
      const positionIds = [...new Set([...candidates.map(({ positionId }) => positionId), ...dto.positionIds])];
      await this.lockPositions(transaction, organizationId, positionIds);
      await this.lockPositionRoles(transaction, organizationId, positionIds);
      await this.lockUsers(transaction, [userId]);
      await transaction.$queryRaw`SELECT id FROM user_positions WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid AND (ended_at IS NULL OR ended_at > ${new Date()}) ORDER BY id FOR UPDATE`;
      const now = new Date();
      const temporal = { startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] };
      const current = await transaction.userPosition.findMany({ where: { organizationId, userId, ...temporal }, select: { id: true, positionId: true } });
      const effective = await transaction.userPosition.findMany({ where: { organizationId, userId, ...effectivePositionAssignmentWhere(now) }, select: { positionId: true } });
      if (JSON.stringify([...new Set(effective.map((entry) => entry.positionId))].sort()) !== JSON.stringify([...new Set(dto.expectedPositionIds)].sort())) adminError('CONCURRENCY_CONFLICT', 409);
      const positions = await transaction.position.findMany({ where: { id: { in: dto.positionIds }, organizationId, status: 'ACTIVE', department: { status: 'ACTIVE' } } });
      if (positions.length !== dto.positionIds.length) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      const existing = new Set(current.map((entry) => entry.positionId));
      const addedIds = dto.positionIds.filter((id) => !existing.has(id));
      const changedIds = [...new Set([...existing].filter((id) => !dto.positionIds.includes(id)).concat(addedIds))];
      const policy = await this.lockPositionRoles(transaction, organizationId, changedIds, addedIds);
      const granted = await this.refreshPositionAccess(transaction, actor, organizationId, ['organization:positions:assign'], policy);
      const before = (await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now, userId)).length > 0;
      await transaction.userPosition.updateMany({ where: { organizationId, userId, ...temporal, positionId: { notIn: dto.positionIds } }, data: { endedAt: now } });
      await transaction.userPosition.createMany({ data: dto.positionIds.filter((positionId) => !existing.has(positionId)).map((positionId) => ({ organizationId, userId, positionId })) });
      const after = (await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now, userId)).length > 0;
      if (before || after) await this.invalidatePositionUsers(transaction, actor, organizationId, [userId], granted);
      await this.record(transaction, actor, organizationId, 'USER_POSITIONS_REPLACED', 'User', userId, traceId);
      return transaction.userPosition.findMany({ where: { organizationId, userId, ...effectivePositionAssignmentWhere() }, include: { position: { select: positionSelect } }, orderBy: [{ positionId: 'asc' }, { id: 'asc' }] });
    });
  }

  private async positionRoleResult(transaction: AdminTransaction, organizationId: string, positionId: string, selfSessionRevoked = false) {
    const position = await transaction.position.findFirst({ where: { organizationId, id: positionId }, select: { roleVersion: true, roles: { select: { roleId: true } } } });
    if (!position) adminError('STRUCTURE_NOT_FOUND', 404);
    const roles = await positionRoleDefinitions(transaction, organizationId, position.roles.map(({ roleId }) => roleId));
    const users = await this.effectivePositionUsers(transaction, organizationId, [positionId]);
    return { positionId, roleVersion: position.roleVersion, roles, effectiveAssigneeCount: users.length, selfSessionRevoked };
  }

  private async lockPositionRoles(transaction: AdminTransaction, organizationId: string, positionIds: string[], grantPositionIds: string[] = []): Promise<PositionRolePolicy> {
    if (!positionIds.length) return { positionIds: [], roles: [], grantableRoles: [] };
    const mappings = await transaction.positionRole.findMany({ where: { organizationId, positionId: { in: positionIds } }, select: { positionId: true, roleId: true } });
    const roles = await positionRoleDefinitions(transaction, organizationId, mappings.map(({ roleId }) => roleId), true);
    const grantedRoleIds = new Set(mappings.filter(({ positionId }) => grantPositionIds.includes(positionId)).map(({ roleId }) => roleId));
    return { positionIds: [...new Set(mappings.map(({ positionId }) => positionId))], roles, grantableRoles: roles.filter(({ id }) => grantedRoleIds.has(id)) };
  }

  private async refreshPositionAccess(transaction: AdminTransaction, actor: AdminActor, organizationId: string, permissions: string[], policy: PositionRolePolicy) {
    // Recheck after every resource lock and before writes: time-bound grants can expire without a DB update.
    await assertRecentAuthentication(transaction, actor);
    const granted = await assertAdminAccess(transaction, actor, organizationId, [...new Set([...permissions, ...(policy.roles.length ? ['account:roles:read', 'account:roles:assign'] : [])])]);
    const organization = await this.activeOrganization(transaction, organizationId);
    assertPositionRolesGrantable(policy.grantableRoles);
    assertPositionRoleCeiling(policy.roles, granted, organization.type);
    return granted;
  }

  private lockOrganization(transaction: AdminTransaction, organizationId: string) {
    return transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
  }

  private async lockPositions(transaction: AdminTransaction, organizationId: string, positionIds: string[]) {
    const ids = [...new Set(positionIds)].sort();
    if (ids.length) await transaction.$queryRaw(Prisma.sql`SELECT id FROM positions WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  private async lockPositionAssignees(transaction: AdminTransaction, organizationId: string, positionIds: string[]) {
    if (!positionIds.length) return;
    // Include future starts: an appointment can become effective while another user's lock is awaited.
    const users = await transaction.user.findMany({ where: { organizationId, positions: { some: { organizationId, positionId: { in: positionIds }, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] } } }, select: { id: true } });
    await this.lockUsers(transaction, users.map(({ id }) => id));
  }

  private async lockUsers(transaction: AdminTransaction, userIds: string[]) {
    const ids = [...new Set(userIds)].sort();
    // Actor/session -> organization -> structure -> roles -> users (sorted); opposing orders yield controlled 409.
    if (ids.length) await transaction.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  private async effectivePositionUsers(transaction: AdminTransaction, organizationId: string, positionIds: string[], now = new Date(), userId?: string) {
    if (!positionIds.length) return [];
    // Composite assignment FKs already enforce each user's home organization; avoid a nested User EXISTS scan.
    const assignments = await transaction.userPosition.findMany({
      where: { userId, organizationId, positionId: { in: positionIds }, ...effectivePositionAssignmentWhere(now) },
      select: { userId: true }, distinct: ['userId'], orderBy: { userId: 'asc' },
    });
    return assignments.map(({ userId: id }) => id);
  }

  private async invalidatePositionUsers(transaction: AdminTransaction, actor: AdminActor, organizationId: string, affected: string[], granted: string[]) {
    const ids = [...new Set(affected)].sort();
    if (!ids.length) return false;
    await transaction.user.updateMany({ where: { id: { in: ids } }, data: { securityVersion: { increment: 1 } } });
    await transaction.passwordReset.updateMany({ where: { userId: { in: ids }, consumedAt: null }, data: { consumedAt: new Date() } });
    if (ids.includes(actor.id)) {
      const after = await adminPermissions(transaction, actor.id, organizationId);
      if (ADMIN_PERMISSIONS.some((code) => granted.includes(code) && !after.includes(code))) adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
    }
    return ids.includes(actor.id);
  }

  private async activeOrganization(transaction: Pick<AdminTransaction, 'organization'>, organizationId: string) {
    const organization = await transaction.organization.findUnique({ where: { id: organizationId } });
    if (!organization) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (organization.status !== 'ACTIVE') adminError('ORGANIZATION_DISABLED', 403);
    return organization;
  }

  private async activeDepartment(transaction: AdminTransaction, organizationId: string, departmentId: string) {
    const department = await transaction.department.findFirst({ where: { organizationId, id: departmentId } });
    if (!department) adminError('STRUCTURE_NOT_FOUND', 404);
    if (department.status !== 'ACTIVE') adminError('STRUCTURE_DISABLED', 409);
    return department;
  }

  private async activeCategory(transaction: AdminTransaction, organizationId: string, categoryId: string) {
    const category = await transaction.positionCategory.findFirst({ where: { id: categoryId, organizationId, status: 'ACTIVE' } });
    if (!category) adminError('STRUCTURE_REFERENCE_INVALID', 409);
  }

  private async noCycle(transaction: AdminTransaction, id: string, parentId: string, organizationId?: string) {
    const visited = new Set([id]);
    let cursor: string | null = parentId;
    while (cursor) {
      if (visited.has(cursor)) adminError('ORGANIZATION_HIERARCHY_INVALID', 409);
      visited.add(cursor);
      const parent: { parentId: string | null } | null = organizationId
        ? await transaction.department.findFirst({ where: { id: cursor, organizationId }, select: { parentId: true } })
        : await transaction.organization.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = parent?.parentId ?? null;
    }
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceType: string, resourceId: string, traceId: string, version?: number) {
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType, resourceId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version } }, transaction);
  }
}
