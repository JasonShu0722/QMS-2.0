import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { grantSupplierBoundaryCaretaker } from '../authorization/supplier-account-authorization.js';
import type { CreateOrganizationDto, UpdateOrganizationDto, OrganizationListQueryDto, CreateDepartmentDto, UpdateDepartmentDto, CreatePositionDto, UpdatePositionDto, ReplaceUserPositionsDto } from './organization.dto.js';

const governancePermissions = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];
const organizationSelect = { id: true, code: true, name: true, type: true, parentId: true, status: true, version: true } as const;
const departmentSelect = { id: true, organizationId: true, code: true, name: true, parentId: true, status: true, version: true } as const;
const positionSelect = { id: true, organizationId: true, code: true, name: true, departmentId: true, categoryId: true, status: true, version: true } as const;

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  lookup(id: string, transaction: Prisma.TransactionClient = this.prisma) {
    return transaction.organization.findUnique({ where: { id }, select: { id: true, name: true, code: true, type: true } });
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
    return this.prisma.organization.findMany({
      where: {
        ...(actor.accountType === 'SUPPLIER' ? { id: actor.organizationId } : {}),
        userRoles: { some: { userId: actor.id, role: { permissions: { some: { permission: { code: 'organization:read' } } } } } },
        OR: [
          { status: 'ACTIVE' },
          { userRoles: { some: { userId: actor.id, role: { permissions: { some: { permission: { code: 'organization:manage' } } } } } } },
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
      await this.activeOrganization(transaction, organizationId);
      const current = await transaction.department.findFirst({ where: { organizationId, id: departmentId } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (dto.parentId) {
        await this.activeDepartment(transaction, organizationId, dto.parentId);
        await this.noCycle(transaction, departmentId, dto.parentId, organizationId);
      }
      const changed = await transaction.department.updateMany({ where: { organizationId, id: departmentId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), parentId: dto.parentId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const result = await transaction.department.findUniqueOrThrow({ where: { id: departmentId }, select: departmentSelect });
      await this.record(transaction, actor, organizationId, 'DEPARTMENT_UPDATED', 'Department', departmentId, traceId, result.version);
      return result;
    });
  }

  async positions(organizationId: string, query: OrganizationListQueryDto) {
    await this.activeOrganization(this.prisma, organizationId);
    return this.prisma.position.findMany({ where: { organizationId }, select: positionSelect, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 });
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
      await this.activeOrganization(transaction, organizationId);
      const current = await transaction.position.findFirst({ where: { organizationId, id: positionId } });
      if (!current) adminError('STRUCTURE_NOT_FOUND', 404);
      if (dto.departmentId || dto.status === 'ACTIVE') await this.activeDepartment(transaction, organizationId, dto.departmentId ?? current.departmentId);
      if (dto.categoryId) await this.activeCategory(transaction, organizationId, dto.categoryId);
      else if (dto.status === 'ACTIVE' && dto.categoryId !== null && current.categoryId) await this.activeCategory(transaction, organizationId, current.categoryId);
      const changed = await transaction.position.updateMany({ where: { organizationId, id: positionId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), departmentId: dto.departmentId, categoryId: dto.categoryId, status: dto.status, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
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
      await this.activeOrganization(transaction, organizationId);
      const user = await transaction.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' } });
      if (!user) adminError('STRUCTURE_NOT_FOUND', 404);
      const current = await transaction.userPosition.findMany({ where: { organizationId, userId, endedAt: null } });
      if (JSON.stringify(current.map((entry) => entry.positionId).sort()) !== JSON.stringify([...dto.expectedPositionIds].sort())) adminError('CONCURRENCY_CONFLICT', 409);
      const positions = await transaction.position.findMany({ where: { id: { in: dto.positionIds }, organizationId, status: 'ACTIVE', department: { status: 'ACTIVE' } } });
      if (positions.length !== dto.positionIds.length) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      await transaction.userPosition.updateMany({ where: { organizationId, userId, endedAt: null, positionId: { notIn: dto.positionIds } }, data: { endedAt: new Date() } });
      const existing = new Set(current.map((entry) => entry.positionId));
      await transaction.userPosition.createMany({ data: dto.positionIds.filter((positionId) => !existing.has(positionId)).map((positionId) => ({ organizationId, userId, positionId })) });
      await this.record(transaction, actor, organizationId, 'USER_POSITIONS_REPLACED', 'User', userId, traceId);
      return transaction.userPosition.findMany({ where: { organizationId, userId, endedAt: null }, include: { position: { select: positionSelect } }, orderBy: { positionId: 'asc' } });
    });
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
