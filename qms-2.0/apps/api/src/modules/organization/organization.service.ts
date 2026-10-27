import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ADMIN_PERMISSIONS, AdminMutationService, adminError, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PositionOnboardingService } from './position-onboarding.service.js';
import { grantSupplierBoundaryCaretaker } from '../authorization/supplier-account-authorization.js';
import { effectivePositionAssignmentWhere, effectiveRoleGrants } from '../../common/security/effective-role-grants.js';
import { assertLegacyPositionRoleWrite, assertPositionRoleCeiling, assertPositionRolesGrantable, positionRoleDefinitions } from '../../common/security/position-role-policy.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { ACTIVE_PERMISSION_CODES } from '../authorization/permission-catalog.js';
import { organizationInitialization, organizationGovernancePermissions, recordOrganizationInitialization, rejectDeletedOrganizationCreation } from './organization-initialization.js';
import { archiveOrganizationHistory, archivedOrganizationDelete } from './organization-history-archive.js';
import { ministerAssignmentReferences, positionManagementReferences, structureBusinessReferences } from './organization-lifecycle.read-model.js';
import type { CreateOrganizationDto, UpdateOrganizationDto, OrganizationListQueryDto, CreateDepartmentDto, UpdateDepartmentDto, CreatePositionDto, UpdatePositionDto, UpdatePositionPermissionsDto, ReplacePositionRolesDto, ReplaceUserPositionsDto, DeleteStructureDto, OrganizationLifecycleDto } from './organization.dto.js';

const governancePermissions = organizationGovernancePermissions;
const organizationSelect = { id: true, code: true, name: true, type: true, parentId: true, status: true, version: true } as const;
const departmentSelect = { id: true, organizationId: true, code: true, name: true, parentId: true, status: true, version: true } as const;
const positionSelect = { id: true, organizationId: true, code: true, name: true, departmentId: true, categoryId: true, status: true, version: true } as const;
type PositionRolePolicy = { positionIds: string[]; roles: Awaited<ReturnType<typeof positionRoleDefinitions>>; grantableRoles: Awaited<ReturnType<typeof positionRoleDefinitions>> };

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly onboarding: PositionOnboardingService) {}

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
      await this.lockOrganization(transaction, parentId);
      const parent = await this.activeOrganization(transaction, parentId);
      const child = await transaction.organization.create({ data: { parentId, code: dto.code, name: dto.name.trim(), type: parent.type }, select: organizationSelect });
      const permissions = await transaction.permission.findMany({ where: { code: { in: governancePermissions.filter((code) => granted.includes(code)) } } });
      const role = await transaction.role.create({ data: { organizationId: child.id, code: 'ORGANIZATION_GOVERNOR', name: '组织治理', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
      await transaction.userRole.create({ data: { userId: actor.id, roleId: role.id, organizationId: child.id } });
      await recordOrganizationInitialization(transaction, child, role.id, actor.id, permissions.map(({ code }) => code).sort(), key!);
      await this.audit.record({ actorUserId: actor.id, organizationId: child.id, action: 'ORGANIZATION_CREATED', resourceType: 'Organization', resourceId: child.id, outcome: 'SUCCESS', traceId,
        metadata: { organizationId: child.id, resourceVersion: child.version, structureCode: child.code, structureName: child.name, structureGovernorRoleId: role.id, permissionCode: permissions.map(({ code }) => code).sort().join(',') } }, transaction);
      return child;
    }, async (transaction) => {
      if (key) await rejectDeletedOrganizationCreation(transaction, actor.id, parentId, key);
      const previous = key ? await transaction.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: actor.id, organizationId: parentId, key } } }) : null;
      if (previous?.action === 'ORGANIZATION_CREATED') {
        const childId = this.receiptValue(previous.response)?.id;
        if (!childId || !await transaction.organization.findUnique({ where: { id: childId }, select: { id: true } })) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      }
    });
  }

  update(actor: AdminActor, organizationId: string, dto: UpdateOrganizationDto, traceId: string, key?: string) {
    if (dto.parentId && dto.expectedParentId === undefined) adminError('CONCURRENCY_CONFLICT', 409);
    const additionalAccess = dto.parentId
      ? [...new Set([dto.parentId, dto.expectedParentId].filter((parentId): parentId is string => typeof parentId === 'string'))].map((parentId) => ({ organizationId: parentId, permission: 'organization:manage' }))
      : [];
    return this.mutations.run({ actor, organizationId, key, action: 'ORGANIZATION_UPDATED', payload: { organizationId, ...dto }, permission: 'organization:manage', additionalAccess, traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'organization:manage');
      const current = await transaction.organization.findUnique({ where: { id: organizationId } });
      if (!current) adminError('ORGANIZATION_NOT_FOUND', 404);
      if (current.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if (dto.status === 'DISABLED') {
        const lifecycle = await this.organizationLifecycleState(transaction, actor, current);
        if (lifecycle.disableBlockers.length) adminError(lifecycle.protected ? 'ADMIN_SELF_LOCK_FORBIDDEN' : 'STRUCTURE_REFERENCE_INVALID', 409);
      }
      if (dto.parentId) {
        if (dto.expectedParentId !== current.parentId) adminError('CONCURRENCY_CONFLICT', 409);
        const parent = await this.activeOrganization(transaction, dto.parentId);
        if (parent.type !== current.type) adminError('ORGANIZATION_TYPE_MISMATCH', 409);
        await this.noCycle(transaction, organizationId, dto.parentId);
      }
      const changed = await transaction.organization.updateMany({ where: { id: organizationId, version: dto.expectedVersion, ...(dto.parentId ? { parentId: dto.expectedParentId } : {}) }, data: { code: dto.code, name: dto.name?.trim(), parentId: dto.parentId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      if (dto.status === 'DISABLED') {
        await transaction.session.updateMany({ where: { user: { organizationId }, revokedAt: null }, data: { revokedAt: new Date() } });
        await transaction.mfaChallenge.updateMany({ where: { user: { organizationId }, consumedAt: null }, data: { consumedAt: new Date() } });
      }
      const result = await transaction.organization.findUniqueOrThrow({ where: { id: organizationId }, select: organizationSelect });
      await this.record(transaction, actor, organizationId, 'ORGANIZATION_UPDATED', 'Organization', organizationId, traceId, result.version, { structurePreviousCode: current.code, structureCode: result.code, structurePreviousName: current.name, structureName: result.name });
      return result;
    });
  }

  async departments(organizationId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    return this.prisma.department.findMany({ where: { organizationId }, select: departmentSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
  }

  createDepartment(actor: AdminActor, organizationId: string, dto: CreateDepartmentDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'DEPARTMENT_CREATED', payload: { organizationId, ...dto }, permission: 'organization:structure:manage', traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.activeOrganization(transaction, organizationId);
      if (dto.parentId) await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${dto.parentId}::uuid FOR SHARE`;
      if (dto.parentId) await this.activeDepartment(transaction, organizationId, dto.parentId);
      const result = await transaction.department.create({ data: { ...dto, name: dto.name.trim(), organizationId }, select: departmentSelect });
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_CREATED', 'Department', result.id, traceId, result.version);
      return result;
    }, async (transaction) => {
      const previous = key ? await transaction.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: actor.id, organizationId, key } } }) : null;
      if (previous?.action === 'DEPARTMENT_CREATED') {
        const departmentId = this.receiptValue(previous.response)?.id;
        if (!departmentId || !await transaction.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } })) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      }
    });
  }

  updateDepartment(actor: AdminActor, organizationId: string, departmentId: string, dto: UpdateDepartmentDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'DEPARTMENT_UPDATED', payload: { organizationId, departmentId, ...dto }, permission: 'organization:structure:manage', traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${departmentId}::uuid FOR UPDATE`;
      await this.activeOrganization(transaction, organizationId);
      const current = await transaction.department.findFirst({ where: { organizationId, id: departmentId } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (current.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
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
      if (dto.status === 'DISABLED' && (await this.departmentLifecycleState(transaction, organizationId, departmentId)).disableBlockers.length) adminError(before.includes(actor.id) ? 'ADMIN_SELF_LOCK_FORBIDDEN' : 'STRUCTURE_REFERENCE_INVALID', 409);
      const changed = await transaction.department.updateMany({ where: { organizationId, id: departmentId, version: dto.expectedVersion }, data: { code: dto.code, name: dto.name?.trim(), parentId: dto.parentId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const after = await this.effectivePositionUsers(transaction, organizationId, policy.positionIds, now);
      await this.invalidatePositionUsers(transaction, actor, organizationId, [...before, ...after], granted);
      const result = await transaction.department.findUniqueOrThrow({ where: { id: departmentId }, select: departmentSelect });
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_UPDATED', 'Department', departmentId, traceId, result.version, { structurePreviousCode: current.code, structureCode: result.code, structurePreviousName: current.name, structureName: result.name });
      return result;
    });
  }

  organizationLifecycle(actor: AdminActor, organizationId: string): Promise<OrganizationLifecycleDto> {
    return this.prisma.$transaction(async (transaction) => {
      // Dependency hints are administrative information, not a member directory capability.
      await assertAdminAccess(transaction, actor, organizationId, 'organization:manage');
      const current = await transaction.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const { protected: _protected, ...lifecycle } = await this.organizationLifecycleState(transaction, actor, current);
      return lifecycle;
    }, { isolationLevel: 'RepeatableRead' });
  }

  departmentLifecycle(actor: AdminActor, organizationId: string, departmentId: string): Promise<OrganizationLifecycleDto> {
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'organization:structure:manage');
      if (!await transaction.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } })) adminError('STRUCTURE_NOT_FOUND', 404);
      return this.departmentLifecycleState(transaction, organizationId, departmentId);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async deleteOrganization(actor: AdminActor, organizationId: string, dto: DeleteStructureDto, traceId: string, key?: string) {
    const target = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { parentId: true } });
    let parentId = target?.parentId;
    if (target && !parentId) {
      await assertAdminAccess(this.prisma, actor, organizationId, 'organization:manage');
      adminError('ADMIN_SELF_LOCK_FORBIDDEN', 409);
    }
    if (!target) {
      // Only this actor's committed delete receipt may recover the frozen parent after deletion.
      const receipt = key ? await this.prisma.adminMutation.findFirst({ where: { actorUserId: actor.id, key, action: 'ORGANIZATION_DELETED', response: { path: ['value', 'id'], equals: organizationId } } }) : null;
      if (!receipt && key) {
        const archived = await archivedOrganizationDelete(this.prisma, actor.id, key, organizationId);
        if (archived) {
          const resolve = async (transaction: AdminTransaction) => {
            const current = await archivedOrganizationDelete(transaction, actor.id, key, organizationId);
            if (!current || current.id !== archived.id || current.scopeOrganizationId !== archived.scopeOrganizationId) adminError('CONCURRENCY_CONFLICT', 409);
            return current;
          };
          return this.mutations.run({ actor, organizationId: archived.scopeOrganizationId, key, action: 'ORGANIZATION_DELETED',
            payload: { organizationId, parentId: archived.organizationId, ...dto }, permission: 'organization:manage', traceId,
            archivedReceipt: { organizationId: archived.organizationId, find: resolve },
          }, async () => { adminError('ORGANIZATION_NOT_FOUND', 404); }, async transaction => { await resolve(transaction); });
        }
      }
      if (!receipt || this.receiptValue(receipt.response)?.deleted !== true) adminError('ORGANIZATION_NOT_FOUND', 404);
      parentId = receipt.organizationId;
    }
    if (!parentId) adminError('ORGANIZATION_NOT_FOUND', 404);
    const frozenParentId = parentId;
    return this.mutations.run({ actor, organizationId: frozenParentId, key, action: 'ORGANIZATION_DELETED', payload: { organizationId, parentId: frozenParentId, ...dto }, permission: 'organization:manage',
      additionalAccess: target ? [{ organizationId, permission: 'organization:manage' }] : [], traceId }, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, frozenParentId, 'organization:manage');
      await assertAdminAccess(transaction, actor, organizationId, 'organization:manage');
      const current = await transaction.organization.findUnique({ where: { id: organizationId } });
      if (!current) adminError('ORGANIZATION_NOT_FOUND', 404);
      if (current.parentId !== frozenParentId || current.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const lifecycle = await this.organizationLifecycleState(transaction, actor, current);
      if (lifecycle.deleteBlockers.length) adminError(lifecycle.protected ? 'ADMIN_SELF_LOCK_FORBIDDEN' : 'STRUCTURE_REFERENCE_INVALID', 409);
      const initialization = await this.initializationAttachments(transaction, actor, current);
      if (initialization.blocked) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      if (initialization.roleId) {
        await transaction.userRole.deleteMany({ where: { organizationId, roleId: initialization.roleId, userId: initialization.grantUserId } });
        await transaction.rolePermission.deleteMany({ where: { roleId: initialization.roleId } });
        await transaction.role.delete({ where: { id: initialization.roleId } });
      }
      await archiveOrganizationHistory(transaction, current, frozenParentId);
      await this.record(transaction, actor, frozenParentId, 'ORGANIZATION_DELETED', 'Organization', organizationId, traceId, current.version,
        { organizationId, structureCode: current.code, structureName: current.name, status: current.status });
      await transaction.organization.delete({ where: { id: organizationId } });
      return { id: organizationId, deleted: true };
    }, async (transaction) => {
      const current = await transaction.organization.findUnique({ where: { id: organizationId }, select: { parentId: true } });
      if (current) {
        if (current.parentId !== frozenParentId) adminError('CONCURRENCY_CONFLICT', 409);
        await assertAdminAccess(transaction, actor, organizationId, 'organization:manage');
      } else {
        const previous = key ? await transaction.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: actor.id, organizationId: frozenParentId, key } } }) : null;
        const response = this.receiptValue(previous?.response);
        if (previous?.action !== 'ORGANIZATION_DELETED' || response?.id !== organizationId || response.deleted !== true) adminError('ORGANIZATION_NOT_FOUND', 404);
      }
    });
  }

  deleteDepartment(actor: AdminActor, organizationId: string, departmentId: string, dto: DeleteStructureDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'DEPARTMENT_DELETED', payload: { organizationId, departmentId, ...dto }, permission: 'organization:structure:manage', traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${departmentId}::uuid FOR UPDATE`;
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'organization:structure:manage');
      const current = await transaction.department.findFirst({ where: { id: departmentId, organizationId } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (current.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if ((await this.departmentLifecycleState(transaction, organizationId, departmentId)).deleteBlockers.length) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_DELETED', 'Department', departmentId, traceId, current.version,
        { structureCode: current.code, structureName: current.name, status: current.status });
      await transaction.department.delete({ where: { id: departmentId } });
      return { id: departmentId, deleted: true };
    });
  }

  private receiptValue(response: unknown): { id: string; deleted?: boolean } | undefined {
    const value = (response as { value?: { id?: unknown; deleted?: unknown } } | undefined)?.value;
    return typeof value?.id === 'string' ? { id: value.id, deleted: value.deleted === true } : undefined;
  }

  private initializationAttachments(transaction: AdminTransaction, _actor: AdminActor, organization: { id: string; parentId: string | null; type: string }) {
    return organizationInitialization(transaction, organization);
  }
  private async organizationLifecycleState(transaction: AdminTransaction, actor: AdminActor, current: { id: string; parentId: string | null; type: string }) {
    const organizationId = current.id;
    const deleteBlockers: string[] = [];
    const disableBlockers: string[] = [];
    const deleteBlockerDetails: NonNullable<OrganizationLifecycleDto['deleteBlockerDetails']> = [];
    const disableBlockerDetails: NonNullable<OrganizationLifecycleDto['disableBlockerDetails']> = [];
    const add = (action: 'delete' | 'disable', code: string, count: number, message: string) => {
      if (count) (action === 'delete' ? deleteBlockerDetails : disableBlockerDetails).push({ code, count, message });
    };
    const protectedOrganization = current.parentId === null || organizationId === actor.organizationId;
    if (protectedOrganization) { deleteBlockers.push('根组织或当前主组织受自锁保护'); disableBlockers.push('根组织或当前主组织受自锁保护'); }
    const children = await transaction.organization.findMany({ where: { parentId: organizationId }, select: { status: true } });
    if (children.length) deleteBlockers.push('存在下级组织');
    if (children.some(({ status }) => status === 'ACTIVE')) disableBlockers.push('存在启用的下级组织');
    add('delete', 'CHILD_ORGANIZATIONS', children.length, '请在组织架构中处理下级组织。');
    add('disable', 'ACTIVE_CHILD_ORGANIZATIONS', children.filter(({ status }) => status === 'ACTIVE').length, '请先停用下级组织。');
    const departments = await transaction.department.findMany({ where: { organizationId }, select: { status: true } });
    if (departments.length) deleteBlockers.push('存在部门');
    if (departments.some(({ status }) => status === 'ACTIVE')) disableBlockers.push('存在启用的部门');
    add('delete', 'DEPARTMENTS', departments.length, '请在组织架构中处理部门；历史引用不能级联清除。');
    add('disable', 'ACTIVE_DEPARTMENTS', departments.filter(({ status }) => status === 'ACTIVE').length, '请先停用部门。');
    const positionCount = await transaction.position.count({ where: { organizationId } });
    const activePositions = await transaction.position.count({ where: { organizationId, status: 'ACTIVE' } });
    const userCount = await transaction.user.count({ where: { organizationId } });
    const activeUsers = await transaction.user.count({ where: { organizationId, status: 'ACTIVE' } });
    const assignmentCount = await transaction.userPosition.count({ where: { organizationId } });
    const effectiveAssignments = await transaction.userPosition.count({ where: { organizationId, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] } });
    if (positionCount) deleteBlockers.push('存在岗位');
    if (activePositions) disableBlockers.push('存在启用的岗位');
    if (userCount) deleteBlockers.push('存在用户账号');
    if (activeUsers) disableBlockers.push('存在启用的用户账号');
    if (assignmentCount) deleteBlockers.push('存在任职历史');
    if (effectiveAssignments) disableBlockers.push('存在有效或待生效任职');
    add('delete', 'POSITIONS', positionCount, '请在部门岗位中核对岗位及引用，不能自动清除。');
    add('disable', 'ACTIVE_POSITIONS', activePositions, '请先处理启用岗位。');
    add('delete', 'USERS', userCount, '请在用户管理核对账号；保留真实账号历史。');
    add('disable', 'ACTIVE_USERS', activeUsers, '请先处理启用账号。');
    add('delete', 'APPOINTMENTS', assignmentCount, '请核对任职历史；结束任职不等于可以清除历史。');
    add('disable', 'EFFECTIVE_APPOINTMENTS', effectiveAssignments, '请先结束有效或待生效任职。');
    const initialization = await this.initializationAttachments(transaction, actor, current);
    if (initialization.blocked) deleteBlockers.push('存在无法识别为初始化的实际角色或授权');
    deleteBlockerDetails.push(...initialization.details);
    const business = await structureBusinessReferences(transaction, organizationId, 'organization');
    if (business.referenced) deleteBlockers.push('存在业务、配置或历史引用');
    if (business.live) disableBlockers.push('存在有效配置或在途业务引用');
    for (const reference of business.details) {
      const source = `${reference.tableName}.${reference.columnName}`;
      add('delete', `REFERENCE:${source}`, reference.count, `存在 ${source} 引用项；请在对应业务或配置中核对，历史引用必须保留。`);
      add('disable', `LIVE_REFERENCE:${source}`, reference.liveCount, `存在 ${source} 有效引用项；请先结束在途业务或停用配置。`);
    }
    return { deleteBlockers, disableBlockers, ...(deleteBlockerDetails.length ? { deleteBlockerDetails } : {}), ...(disableBlockerDetails.length ? { disableBlockerDetails } : {}), protected: protectedOrganization };
  }

  private async departmentLifecycleState(transaction: AdminTransaction, organizationId: string, departmentId: string): Promise<OrganizationLifecycleDto> {
    const deleteBlockers: string[] = [];
    const disableBlockers: string[] = [];
    const children = await transaction.department.findMany({ where: { organizationId, parentId: departmentId }, select: { status: true } });
    if (children.length) deleteBlockers.push('存在下级部门');
    if (children.some(({ status }) => status === 'ACTIVE')) disableBlockers.push('存在启用的下级部门');
    if (await transaction.position.count({ where: { organizationId, departmentId } })) deleteBlockers.push('存在岗位或任职历史');
    if (await transaction.position.count({ where: { organizationId, departmentId, status: 'ACTIVE' } })) disableBlockers.push('存在启用的岗位');
    if (await transaction.userPosition.count({ where: { organizationId, position: { organizationId, departmentId }, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] } })) disableBlockers.push('存在有效或待生效任职');
    const business = await structureBusinessReferences(transaction, departmentId, 'department');
    if (business.referenced) deleteBlockers.push('存在业务或历史引用');
    if (business.live) disableBlockers.push('存在有效配置或在途业务引用');
    return { deleteBlockers, disableBlockers };
  }

  async positions(organizationId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    return this.prisma.position.findMany({ where: { organizationId }, select: positionSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
  }

  async positionRoles(actor: AdminActor, organizationId: string, positionId: string) {
    await assertAdminAccess(this.prisma, actor, organizationId, ['organization:structure:read', 'account:roles:read']);
    return this.positionRoleResult(this.prisma, organizationId, positionId);
  }

  async positionPermissions(actor: AdminActor, organizationId: string, positionId: string) {
    await assertAdminAccess(this.prisma, actor, organizationId, ['organization:structure:read', 'account:roles:read']);
    return this.positionPermissionResult(this.prisma, organizationId, positionId);
  }

  updatePositionPermissions(actor: AdminActor, organizationId: string, positionId: string, dto: UpdatePositionPermissionsDto, traceId: string, key?: string) {
    const permission = ['organization:structure:manage', 'account:roles:read', 'account:roles:update', 'account:roles:assign'];
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_PERMISSIONS_CHANGED', payload: { organizationId, positionId, ...dto }, permission, traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      const organization = await this.activeOrganization(transaction, organizationId);
      if (organization.type !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
      await this.lockPositions(transaction, organizationId, [positionId]);
      const current = await transaction.position.findFirst({ where: { organizationId, id: positionId }, select: { id: true, name: true, roleVersion: true, roles: { select: { roleId: true, isCanonical: true } } } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      const roles = await positionRoleDefinitions(transaction, organizationId, current.roles.map(({ roleId }) => roleId), true);
      await this.lockPositionAssignees(transaction, organizationId, [positionId]);
      const granted = await this.refreshPositionAccess(transaction, actor, organizationId, permission, { positionIds: [positionId], roles, grantableRoles: [] });
      const canonicalId = current.roles.find(({ isCanonical }) => isCanonical)?.roleId;
      const own = roles.find(({ id }) => id === canonicalId);
      const codes = own?.permissions.map(({ code }) => code).sort() ?? [];
      if (current.roleVersion !== dto.expectedRoleVersion || current.roleVersion >= 2147483647
        || JSON.stringify(codes) !== JSON.stringify([...new Set(dto.expectedPermissionCodes)].sort())
        || (own?.mfaRequired ?? false) !== dto.expectedMfaRequired) adminError('CONCURRENCY_CONFLICT', 409);
      const nextCodes = [...new Set(dto.permissionCodes)];
      if (nextCodes.some((code) => !ACTIVE_PERMISSION_CODES.includes(code))) adminError('ADMIN_PERMISSION_NOT_FOUND', 400);
      const permissions = await transaction.permission.findMany({ where: { code: { in: nextCodes } }, select: { id: true } });
      if (permissions.length !== nextCodes.length) adminError('ADMIN_PERMISSION_NOT_FOUND', 400);
      if (nextCodes.some((code) => !granted.includes(code))) adminError('FEATURE_PERMISSION_DENIED', 403);
      if (canonicalId && JSON.stringify([...nextCodes].sort()) === JSON.stringify(codes) && dto.mfaRequired === (own?.mfaRequired ?? false)) return this.positionPermissionResult(transaction, organizationId, positionId);
      const roleId = canonicalId ?? (await this.createCanonicalRole(transaction, organizationId, current)).id;
      await transaction.role.update({ where: { id: roleId }, data: { mfaRequired: dto.mfaRequired } });
      await transaction.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length) await transaction.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId, permissionId: id })) });
      const changed = await transaction.position.updateMany({ where: { organizationId, id: positionId, roleVersion: dto.expectedRoleVersion }, data: { roleVersion: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const affected = await this.effectivePositionUsers(transaction, organizationId, [positionId]);
      const selfSessionRevoked = await this.invalidatePositionUsers(transaction, actor, organizationId, affected, granted);
      await this.record(transaction, actor, organizationId, 'POSITION_PERMISSIONS_CHANGED', 'Position', positionId, traceId, dto.expectedRoleVersion + 1);
      return this.positionPermissionResult(transaction, organizationId, positionId, selfSessionRevoked);
    });
  }

  replacePositionRoles(actor: AdminActor, organizationId: string, positionId: string, dto: ReplacePositionRolesDto, traceId: string, key?: string) {
    const roleIds = [...new Set(dto.roleIds)].sort();
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_ROLES_CHANGED', payload: { organizationId, positionId, roleIds, expectedRoleVersion: dto.expectedRoleVersion }, permission: ['organization:structure:manage', 'account:roles:read', 'account:roles:assign'], traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.lockPositions(transaction, organizationId, [positionId]);
      await assertLegacyPositionRoleWrite(transaction, organizationId, positionId, roleIds);
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
    }, (transaction) => assertLegacyPositionRoleWrite(transaction, organizationId, positionId, roleIds));
  }

  createPosition(actor: AdminActor, organizationId: string, dto: CreatePositionDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'POSITION_CREATED', payload: { organizationId, ...dto }, permission: 'organization:structure:manage', traceId, duplicateCode: 'STRUCTURE_DUPLICATE' }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      const organization = await this.activeOrganization(transaction, organizationId);
      await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${dto.departmentId}::uuid FOR SHARE`;
      await this.activeDepartment(transaction, organizationId, dto.departmentId);
      if (dto.categoryId) await this.activeCategory(transaction, organizationId, dto.categoryId);
      const result = await transaction.position.create({ data: { ...dto, name: dto.name.trim(), organizationId }, select: positionSelect });
      if (organization.type === 'INTERNAL') await this.createCanonicalRole(transaction, organizationId, result);
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
      if (dto.status === 'DISABLED' && await transaction.userPosition.count({ where: { organizationId, positionId, OR: [{ endedAt: null }, { endedAt: { gt: now } }] } })) adminError(before.includes(actor.id) ? 'ADMIN_SELF_LOCK_FORBIDDEN' : 'STRUCTURE_REFERENCE_INVALID', 409);
      if ((dto.status === 'DISABLED' || (dto.departmentId !== undefined && dto.departmentId !== current.departmentId))
        && await positionManagementReferences(transaction, organizationId, positionId, now)) {
        adminError(before.includes(actor.id) ? 'ADMIN_SELF_LOCK_FORBIDDEN' : 'STRUCTURE_REFERENCE_INVALID', 409);
      }
      const changed = await transaction.position.updateMany({ where: { organizationId, id: positionId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), departmentId: dto.departmentId, categoryId: dto.categoryId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      if (dto.name !== undefined) {
        const canonical = await transaction.positionRole.findFirst({ where: { organizationId, positionId, isCanonical: true }, select: { roleId: true } });
        if (canonical) await transaction.role.update({ where: { id: canonical.roleId }, data: { name: [...dto.name.trim()].slice(0, 150).join('') } });
      }
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

  replaceUserPositions(actor: AdminActor, organizationId: string, userId: string, dto: ReplaceUserPositionsDto & { authorizationBaseline?: string }, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId, key, action: 'USER_POSITIONS_REPLACED', payload: { organizationId, userId, ...dto }, permission: 'organization:positions:assign', traceId }, async (transaction) => {
      await this.lockOrganization(transaction, organizationId);
      await this.activeOrganization(transaction, organizationId);
      const user = await transaction.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' } });
      if (!user) adminError('STRUCTURE_NOT_FOUND', 404);
      const candidates = await transaction.userPosition.findMany({ where: { organizationId, userId, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] }, select: { positionId: true } });
      const positionIds = [...new Set([...candidates.map(({ positionId }) => positionId), ...dto.positionIds])];
      // Department status and appointment writes share the same parent -> position lock order.
      if (positionIds.length) await transaction.$queryRaw(Prisma.sql`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id IN (SELECT department_id FROM positions WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(positionIds.map((id) => Prisma.sql`${id}::uuid`))})) ORDER BY id FOR SHARE`);
      await this.lockPositions(transaction, organizationId, positionIds);
      await this.lockPositionRoles(transaction, organizationId, positionIds);
      if (dto.authorizationBaseline !== undefined) await this.onboarding.verifyAdjustment(transaction, actor, organizationId, { ...dto, authorizationBaseline: dto.authorizationBaseline, targetUserId: userId });
      await this.lockUsers(transaction, [userId]);
      await transaction.$queryRaw`SELECT id FROM user_positions WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid AND (ended_at IS NULL OR ended_at > ${new Date()}) ORDER BY id FOR UPDATE`;
      const now = new Date();
      const temporal = { startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] };
      const current = await transaction.userPosition.findMany({ where: { organizationId, userId, ...temporal }, select: { id: true, positionId: true } });
      const effective = await transaction.userPosition.findMany({ where: { organizationId, userId, ...effectivePositionAssignmentWhere(now) }, select: { positionId: true } });
      if (JSON.stringify([...new Set(effective.map((entry) => entry.positionId))].sort()) !== JSON.stringify([...new Set(dto.expectedPositionIds)].sort())) adminError('CONCURRENCY_CONFLICT', 409);
      const removedAssignments = current.filter(({ positionId }) => !dto.positionIds.includes(positionId)).map(({ id }) => id);
      if (await ministerAssignmentReferences(transaction, organizationId, removedAssignments, now)) adminError('STRUCTURE_REFERENCE_INVALID', 409);
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
    }, async (transaction) => {
      if (dto.authorizationBaseline !== undefined) await this.onboarding.authorizeAdjustment(transaction, actor, organizationId, { ...dto, authorizationBaseline: dto.authorizationBaseline, targetUserId: userId });
    });
  }

  private async positionRoleResult(transaction: AdminTransaction, organizationId: string, positionId: string, selfSessionRevoked = false) {
    const position = await transaction.position.findFirst({ where: { organizationId, id: positionId }, select: { roleVersion: true, roles: { select: { roleId: true } } } });
    if (!position) adminError('STRUCTURE_NOT_FOUND', 404);
    const roles = await positionRoleDefinitions(transaction, organizationId, position.roles.map(({ roleId }) => roleId));
    const users = await this.effectivePositionUsers(transaction, organizationId, [positionId]);
    return { positionId, roleVersion: position.roleVersion, roles, effectiveAssigneeCount: users.length, selfSessionRevoked };
  }

  private async createCanonicalRole(transaction: AdminTransaction, organizationId: string, position: { id: string; name: string }) {
    const role = await transaction.role.create({ data: { organizationId, code: `POS_${randomUUID()}`, name: [...position.name].slice(0, 150).join('') } });
    await transaction.positionRole.create({ data: { organizationId, positionId: position.id, roleId: role.id, isCanonical: true } });
    return role;
  }

  private async positionPermissionResult(transaction: AdminTransaction, organizationId: string, positionId: string, selfSessionRevoked = false) {
    const position = await transaction.position.findFirst({ where: { organizationId, id: positionId }, select: { roleVersion: true, roles: { select: { roleId: true, isCanonical: true } } } });
    if (!position) adminError('STRUCTURE_NOT_FOUND', 404);
    const roles = await positionRoleDefinitions(transaction, organizationId, position.roles.map(({ roleId }) => roleId));
    const canonicalId = position.roles.find(({ isCanonical }) => isCanonical)?.roleId;
    const own = roles.find(({ id }) => id === canonicalId);
    const legacyIds = new Set(position.roles.filter(({ isCanonical }) => !isCanonical).map(({ roleId }) => roleId));
    const users = await this.effectivePositionUsers(transaction, organizationId, [positionId]);
    return { positionId, roleVersion: position.roleVersion, permissionCodes: own?.permissions.map(({ code }) => code).sort() ?? [], mfaRequired: own?.mfaRequired ?? false, legacyRoles: roles.filter(({ id }) => legacyIds.has(id)), effectiveAssigneeCount: users.length, selfSessionRevoked };
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

  async lockActiveDepartment(transaction: AdminTransaction, organizationId: string, departmentId: string | null) {
    if (!departmentId) return null;
    await this.lockOrganization(transaction, organizationId);
    if ((await transaction.organization.findUnique({ where: { id: organizationId }, select: { status: true } }))?.status !== 'ACTIVE') return null;
    await transaction.$queryRaw`SELECT id FROM departments WHERE organization_id = ${organizationId}::uuid AND id = ${departmentId}::uuid FOR SHARE`;
    return transaction.department.findFirst({ where: { id: departmentId, organizationId, status: 'ACTIVE' } });
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

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceType: string, resourceId: string, traceId: string, version?: number, metadata: Prisma.InputJsonObject = {}) {
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType, resourceId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version, ...metadata } }, transaction);
  }
}
