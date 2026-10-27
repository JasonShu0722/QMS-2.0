import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type {
  CreateManagementBindingDto, CreateMinisterScopeDto, ManagementBindingDto,
  ManagementConfigurationQueryDto, ManagementResponsibilitiesDto, MinisterScopeDto,
  ResponsibilityAssignmentsDto, ResponsibilityAssignmentsQueryDto,
  UpdateManagementBindingDto, UpdateMinisterScopeDto, ResponsibilityAssignmentDto,
} from './organization-responsibility.dto.js';

const bindingColumns = Prisma.sql`id, organization_id AS "organizationId", department_id AS "departmentId", responsibility,
  position_id AS "positionId", status, version, created_by AS "createdBy", updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;
const scopeColumns = Prisma.sql`id, organization_id AS "organizationId", department_id AS "departmentId", section_department_id AS "sectionDepartmentId",
  minister_assignment_id AS "ministerAssignmentId", valid_from AS "validFrom", valid_to AS "validTo", status, version,
  created_by AS "createdBy", updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;
const assignmentInclude = {
  user: { select: { organizationId: true, status: true, accountType: true, username: true, fullName: true } },
  position: { select: { organizationId: true, departmentId: true, status: true, name: true, version: true, department: { select: { status: true } } } },
} as const;
type Assignment = Prisma.UserPositionGetPayload<{ include: typeof assignmentInclude }>;

@Injectable()
export class OrganizationResponsibilityService {
  private readonly userLockBudgets = new WeakMap<AdminTransaction, ReadonlySet<string>>();

  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  // Minimal directory projection for an already-authorized workflow transaction.
  async workflowDepartmentOptions(tx: AdminTransaction, organizationId: string, search: string | undefined, take: number, skip: number, sectionDepartmentId?: string) {
    await this.activeOrganization(tx, organizationId);
    const where: Prisma.DepartmentWhereInput = { organizationId, status: 'ACTIVE', ...(sectionDepartmentId ? { id: sectionDepartmentId } : {}), ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await Promise.all([tx.department.findMany({ where, select: { id: true, code: true, name: true }, orderBy: [{ code: 'asc' }, { id: 'asc' }], take, skip }), tx.department.count({ where })]);
    return { items, total };
  }

  async listManagementBindings(organizationId: string, query: ManagementConfigurationQueryDto): Promise<ManagementBindingDto[]> {
    await this.activeOrganization(this.prisma, organizationId);
    return this.bindings(this.prisma, organizationId, Prisma.sql`${query.departmentId ? Prisma.sql`department_id = ${query.departmentId}::uuid` : Prisma.sql`TRUE`}
      ORDER BY created_at, id LIMIT ${query.limit ?? 100} OFFSET ${query.offset ?? 0}`);
  }

  createManagementBinding(actor: AdminActor, organizationId: string, dto: CreateManagementBindingDto, traceId: string, key?: string): Promise<ManagementBindingDto> {
    return this.mutations.run({ actor, organizationId, key, action: 'MANAGEMENT_BINDING_CREATED', payload: dto, permission: 'organization:structure:manage', traceId }, async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await this.lockDepartments(tx, organizationId, [dto.departmentId]);
      await this.lockPositions(tx, organizationId, [dto.positionId]);
      await this.refreshAccess(tx, actor, organizationId);
      await this.assertBindingPosition(tx, organizationId, dto.departmentId, dto.positionId);
      if ((await this.bindings(tx, organizationId, Prisma.sql`department_id = ${dto.departmentId}::uuid AND responsibility = ${dto.responsibility} AND status = 'ACTIVE'`)).length) adminError('CONCURRENCY_CONFLICT', 409);
      const rows = await this.configurationQuery<ManagementBindingDto>(tx, Prisma.sql`
        INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${dto.departmentId}::uuid, ${dto.responsibility}, ${dto.positionId}::uuid, ${actor.id}::uuid, ${actor.id}::uuid)
        RETURNING ${bindingColumns}`);
      const result = rows[0]!;
      await this.bindingAudit(tx, actor, result, traceId);
      return result;
    });
  }

  updateManagementBinding(actor: AdminActor, organizationId: string, bindingId: string, dto: UpdateManagementBindingDto, traceId: string, key?: string): Promise<ManagementBindingDto> {
    return this.mutations.run({ actor, organizationId, key, action: 'MANAGEMENT_BINDING_UPDATED', payload: { bindingId, ...dto }, permission: 'organization:structure:manage', traceId }, async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const before = (await this.bindings(tx, organizationId, Prisma.sql`id = ${bindingId}::uuid`))[0];
      if (!before) adminError('STRUCTURE_NOT_FOUND', 404);
      await this.lockDepartments(tx, organizationId, [before.departmentId]);
      await this.lockPositions(tx, organizationId, [before.positionId, dto.positionId ?? before.positionId]);
      await this.refreshAccess(tx, actor, organizationId);
      if (before.version !== dto.expectedVersion || before.version === 2147483647) adminError('CONCURRENCY_CONFLICT', 409);
      const positionId = dto.positionId ?? before.positionId;
      const status = dto.status ?? before.status;
      if (status === 'ACTIVE') await this.assertBindingPosition(tx, organizationId, before.departmentId, positionId);
      if (before.responsibility === 'MINISTER' && (positionId !== before.positionId || status !== before.status)) {
        if ((await this.scopes(tx, organizationId, Prisma.sql`department_id = ${before.departmentId}::uuid AND status = 'ACTIVE' AND (valid_to IS NULL OR valid_to > ${new Date()})`)).length) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      }
      if (status === 'ACTIVE' && (await this.bindings(tx, organizationId, Prisma.sql`department_id = ${before.departmentId}::uuid AND responsibility = ${before.responsibility} AND status = 'ACTIVE' AND id <> ${bindingId}::uuid`)).length) adminError('CONCURRENCY_CONFLICT', 409);
      const rows = await this.configurationQuery<ManagementBindingDto>(tx, Prisma.sql`
        UPDATE department_management_bindings SET position_id = ${positionId}::uuid, status = ${status},
          version = version + 1, updated_by = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${bindingId}::uuid AND version = ${dto.expectedVersion}
        RETURNING ${bindingColumns}`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.bindingAudit(tx, actor, rows[0], traceId, before);
      return rows[0];
    });
  }

  async listMinisterScopes(organizationId: string, query: ManagementConfigurationQueryDto): Promise<MinisterScopeDto[]> {
    await this.activeOrganization(this.prisma, organizationId);
    return this.scopes(this.prisma, organizationId, Prisma.sql`${query.departmentId ? Prisma.sql`department_id = ${query.departmentId}::uuid` : Prisma.sql`TRUE`}
      ORDER BY valid_from, id LIMIT ${query.limit ?? 100} OFFSET ${query.offset ?? 0}`);
  }

  createMinisterScope(actor: AdminActor, organizationId: string, dto: CreateMinisterScopeDto, traceId: string, key?: string): Promise<MinisterScopeDto> {
    return this.mutations.run({ actor, organizationId, key, action: 'MINISTER_SCOPE_CREATED', payload: dto, permission: 'organization:structure:manage', traceId }, async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await this.lockDepartments(tx, organizationId, [dto.departmentId, dto.sectionDepartmentId]);
      const assignment = await this.lockAssignment(tx, organizationId, dto.ministerAssignmentId);
      await this.refreshAccess(tx, actor, organizationId);
      const binding = await this.assertMinisterScope(tx, organizationId, dto.departmentId, dto.sectionDepartmentId, assignment);
      const validFrom = dto.validFrom === undefined ? new Date() : new Date(dto.validFrom);
      const validTo = dto.validTo === undefined ? assignment.endedAt : dto.validTo === null ? null : new Date(dto.validTo);
      this.assertInterval(assignment, validFrom, validTo);
      const rows = await this.configurationQuery<MinisterScopeDto>(tx, Prisma.sql`
        INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, valid_to, created_by, updated_by)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${dto.departmentId}::uuid, ${dto.sectionDepartmentId}::uuid, ${dto.ministerAssignmentId}::uuid, ${validFrom}, ${validTo}, ${actor.id}::uuid, ${actor.id}::uuid)
        RETURNING ${scopeColumns}`);
      const result = rows[0]!;
      await this.scopeAudit(tx, actor, result, binding, traceId);
      return result;
    });
  }

  updateMinisterScope(actor: AdminActor, organizationId: string, scopeId: string, dto: UpdateMinisterScopeDto, traceId: string, key?: string): Promise<MinisterScopeDto> {
    return this.mutations.run({ actor, organizationId, key, action: 'MINISTER_SCOPE_UPDATED', payload: { scopeId, ...dto }, permission: 'organization:structure:manage', traceId }, async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const before = (await this.scopes(tx, organizationId, Prisma.sql`id = ${scopeId}::uuid`))[0];
      if (!before) adminError('STRUCTURE_NOT_FOUND', 404);
      const sectionDepartmentId = dto.sectionDepartmentId ?? before.sectionDepartmentId;
      await this.lockDepartments(tx, organizationId, [before.departmentId, before.sectionDepartmentId, sectionDepartmentId]);
      const assignment = await this.lockAssignment(tx, organizationId, dto.ministerAssignmentId ?? before.ministerAssignmentId);
      await this.refreshAccess(tx, actor, organizationId);
      if (before.version !== dto.expectedVersion || before.version === 2147483647) adminError('CONCURRENCY_CONFLICT', 409);
      const status = dto.status ?? before.status;
      const validFrom = dto.validFrom === undefined ? before.validFrom : new Date(dto.validFrom);
      const validTo = dto.validTo === undefined ? before.validTo : dto.validTo === null ? null : new Date(dto.validTo);
      let binding: ManagementBindingDto;
      if (status === 'ACTIVE' || dto.sectionDepartmentId !== undefined || dto.ministerAssignmentId !== undefined || dto.validFrom !== undefined || dto.validTo !== undefined) {
        binding = await this.assertMinisterScope(tx, organizationId, before.departmentId, sectionDepartmentId, assignment);
        this.assertInterval(assignment, validFrom, validTo);
      } else {
        binding = (await this.bindings(tx, organizationId, Prisma.sql`department_id = ${before.departmentId}::uuid AND responsibility = 'MINISTER' AND position_id = ${assignment.positionId}::uuid ORDER BY created_at DESC, id DESC`))[0]!;
        if (!binding) adminError('STRUCTURE_REFERENCE_INVALID', 409);
      }
      const rows = await this.configurationQuery<MinisterScopeDto>(tx, Prisma.sql`
        UPDATE department_minister_scopes SET section_department_id = ${sectionDepartmentId}::uuid, minister_assignment_id = ${assignment.id}::uuid,
          valid_from = ${validFrom}, valid_to = ${validTo}, status = ${status}, version = version + 1,
          updated_by = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${scopeId}::uuid AND version = ${dto.expectedVersion}
        RETURNING ${scopeColumns}`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.scopeAudit(tx, actor, rows[0], binding, traceId, before);
      return rows[0];
    });
  }

  async managementResponsibilities(organizationId: string, sectionDepartmentId: string): Promise<ManagementResponsibilitiesDto> {
    try {
      return await this.prisma.$transaction((tx) => this.resolveManagementResponsibilities(tx, organizationId, sectionDepartmentId));
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  async responsibilityAssignments(organizationId: string, query: ResponsibilityAssignmentsQueryDto): Promise<ResponsibilityAssignmentsDto> {
    await this.activeOrganization(this.prisma, organizationId);
    const at = new Date();
    const where: Prisma.UserPositionWhereInput = {
      organizationId, ...this.effectiveAssignmentWhere(organizationId, at),
      position: { organizationId, departmentId: query.departmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } },
      ...(query.search ? { AND: [
        { OR: [
          { user: { username: { contains: query.search, mode: 'insensitive' } } },
          { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
          { position: { name: { contains: query.search, mode: 'insensitive' } } },
        ] },
      ] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userPosition.findMany({ where, include: assignmentInclude, orderBy: [{ positionId: 'asc' }, { id: 'asc' }], take: query.limit ?? 100, skip: query.offset ?? 0 }),
      this.prisma.userPosition.count({ where }),
    ]);
    return { items: rows.map((row) => this.assignmentResult(row)), total };
  }

  async resolveManagementResponsibilities(tx: AdminTransaction, organizationId: string, sectionDepartmentId: string, at = new Date(), additionalUserIds: string[] = [], fenceUserLocks = false): Promise<ManagementResponsibilitiesDto> {
    try {
      return await this.resolveLockedResponsibilities(tx, organizationId, sectionDepartmentId, at, additionalUserIds, fenceUserLocks);
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  // Recheck only the resolver's locked identities; never resolve or lock new users here.
  async revalidateLockedManagementResponsibilities(tx: AdminTransaction, management: ManagementResponsibilitiesDto, at: Date): Promise<Set<string>> {
    const { organizationId, sectionDepartmentId } = management;
    const validSources = new Set<string>();
    for (const source of management.responsibilities) {
      const assignment = await tx.userPosition.findFirst({ where: { id: source.assignmentId, organizationId,
        userId: source.userId, positionId: source.positionId, ...this.effectiveAssignmentWhere(organizationId, at),
        position: { organizationId, departmentId: source.departmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } } }, select: { id: true } });
      if (!assignment) continue;
      if (source.responsibility === 'SECTION_MANAGER' && await tx.userPosition.count({ where: {
        organizationId, positionId: source.positionId, ...this.effectiveAssignmentWhere(organizationId, at),
        position: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
      } }) !== 1) continue;
      const [binding] = await tx.$queryRaw<{ id: string }[]>`SELECT b.id FROM department_management_bindings b
        WHERE b.id = ${source.bindingId}::uuid AND b.organization_id = ${organizationId}::uuid AND b.status = 'ACTIVE'
          AND b.version = ${source.bindingVersion} AND b.position_id = ${source.positionId}::uuid
          AND b.department_id = ${source.departmentId}::uuid AND b.responsibility = ${source.responsibility}
          AND (${source.scopeId}::uuid IS NULL OR EXISTS (SELECT 1 FROM department_minister_scopes s
            WHERE s.id = ${source.scopeId}::uuid AND s.organization_id = b.organization_id AND s.status = 'ACTIVE'
              AND s.version = ${source.scopeVersion} AND s.department_id = b.department_id
              AND s.section_department_id = ${sectionDepartmentId}::uuid AND s.minister_assignment_id = ${source.assignmentId}::uuid
              AND s.valid_from <= ${at} AND (s.valid_to IS NULL OR s.valid_to > ${at})))`;
      if (binding) validSources.add(source.bindingId);
    }
    return validSources;
  }

  private async resolveLockedResponsibilities(tx: AdminTransaction, organizationId: string, sectionDepartmentId: string, at: Date, additionalUserIds: string[], fenceUserLocks: boolean): Promise<ManagementResponsibilitiesDto> {
    if (!Number.isFinite(at.getTime())) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    const result: ManagementResponsibilitiesDto = { organizationId, sectionDepartmentId, at, responsibilities: [], issues: [] };
    // Authentication writers lock users first; callers must resolve before taking structure locks.
    const candidates = await this.responsibilityConfiguration(tx, organizationId, sectionDepartmentId, at);
    const candidateAssignments = candidates.positions.length ? await tx.userPosition.findMany({
      where: { organizationId, positionId: { in: candidates.positions }, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
      select: { userId: true },
    }) : [];
    const lockedUsers = new Set((await this.lockUsers(tx, organizationId, [...candidateAssignments.map(({ userId }) => userId), ...additionalUserIds])).map(({ id }) => id));
    // Later live resolvers must not grow the user lock set after this caller takes project locks.
    if (fenceUserLocks && !this.userLockBudgets.has(tx)) this.userLockBudgets.set(tx, lockedUsers);
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    await this.lockDepartments(tx, organizationId, [sectionDepartmentId], false);
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    const section = await tx.department.findFirst({ where: { organizationId, id: sectionDepartmentId, status: 'ACTIVE' } });
    if (!organization || organization.status !== 'ACTIVE' || organization.type !== 'INTERNAL' || !section) {
      result.issues.push(...(['SECTION_MANAGER', 'MINISTER'] as const).map((responsibility) => ({ responsibility, code: 'STRUCTURE_INACTIVE' as const })));
      return result;
    }
    const { scopes, managers, ministers, positions } = await this.responsibilityConfiguration(tx, organizationId, sectionDepartmentId, at);
    await this.lockPositions(tx, organizationId, positions, false);
    if (positions.length) {
      const assignments = await tx.userPosition.findMany({
        where: { organizationId, positionId: { in: positions }, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
        select: { id: true, userId: true },
      });
      // Never acquire a new user lock after structure locks; a changed candidate set needs a retry.
      if (assignments.some(({ userId }) => !lockedUsers.has(userId))) adminError('CONCURRENCY_CONFLICT', 409);
      await this.lockAssignmentRows(tx, organizationId, assignments, false);
    }
    for (const responsibility of ['SECTION_MANAGER', 'MINISTER'] as const) {
      if (responsibility === 'MINISTER' && scopes.length !== 1) {
        result.issues.push({ responsibility, code: scopes.length ? 'SCOPE_AMBIGUOUS' : 'SCOPE_MISSING' });
        continue;
      }
      const bindings = responsibility === 'SECTION_MANAGER' ? managers : ministers;
      if (bindings.length !== 1) {
        result.issues.push({ responsibility, code: bindings.length ? 'BINDING_AMBIGUOUS' : 'BINDING_MISSING' });
        continue;
      }
      const binding = bindings[0]!;
      const scope = responsibility === 'MINISTER' ? scopes[0]! : null;
      const department = await tx.department.findFirst({ where: { organizationId, id: binding.departmentId, status: 'ACTIVE' } });
      if (!department || (scope && !await this.isDescendant(tx, organizationId, scope.departmentId, sectionDepartmentId))) {
        result.issues.push({ responsibility, code: 'STRUCTURE_INACTIVE' });
        continue;
      }
      const assignments = await tx.userPosition.findMany({
        where: { organizationId, positionId: binding.positionId, ...(scope ? { id: scope.ministerAssignmentId } : {}),
          ...this.effectiveAssignmentWhere(organizationId, at),
          position: { organizationId, departmentId: binding.departmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } },
        }, include: assignmentInclude, orderBy: { id: 'asc' },
      });
      if (assignments.length !== 1) {
        result.issues.push({ responsibility, code: assignments.length ? 'ASSIGNMENT_AMBIGUOUS' : 'ASSIGNMENT_MISSING' });
        continue;
      }
      result.responsibilities.push({ ...this.assignmentResult(assignments[0]!), responsibility,
        bindingId: binding.id, bindingVersion: binding.version, scopeId: scope?.id ?? null, scopeVersion: scope?.version ?? null,
        departmentVersion: department.version, sectionDepartmentVersion: section.version, organizationVersion: organization.version,
      });
    }
    return result;
  }

  private async responsibilityConfiguration(tx: AdminTransaction, organizationId: string, sectionDepartmentId: string, at: Date) {
    const scopes = await this.scopes(tx, organizationId, Prisma.sql`section_department_id = ${sectionDepartmentId}::uuid AND status = 'ACTIVE' AND valid_from <= ${at} AND (valid_to IS NULL OR valid_to > ${at})`);
    const managers = await this.bindings(tx, organizationId, Prisma.sql`department_id = ${sectionDepartmentId}::uuid AND responsibility = 'SECTION_MANAGER' AND status = 'ACTIVE'`);
    const ministers = scopes.length === 1 ? await this.bindings(tx, organizationId, Prisma.sql`department_id = ${scopes[0]!.departmentId}::uuid AND responsibility = 'MINISTER' AND status = 'ACTIVE'`) : [];
    return { scopes, managers, ministers, positions: [...new Set([...managers, ...ministers].map(({ positionId }) => positionId))].sort() };
  }

  private bindings(tx: AdminTransaction, organizationId: string, condition: Prisma.Sql) {
    return tx.$queryRaw<ManagementBindingDto[]>(Prisma.sql`SELECT ${bindingColumns} FROM department_management_bindings WHERE organization_id = ${organizationId}::uuid AND ${condition}`);
  }

  private scopes(tx: AdminTransaction, organizationId: string, condition: Prisma.Sql) {
    return tx.$queryRaw<MinisterScopeDto[]>(Prisma.sql`SELECT ${scopeColumns} FROM department_minister_scopes WHERE organization_id = ${organizationId}::uuid AND ${condition}`);
  }

  private async lockOrganization(tx: AdminTransaction, organizationId: string) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    await this.activeOrganization(tx, organizationId);
  }

  private async activeOrganization(tx: AdminTransaction, organizationId: string) {
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (organization.status !== 'ACTIVE') adminError('ORGANIZATION_DISABLED', 403);
    if (organization.type !== 'INTERNAL') adminError('STRUCTURE_REFERENCE_INVALID', 409);
    return organization;
  }

  private async lockDepartments(tx: AdminTransaction, organizationId: string, ids: string[], write = true) {
    if (!ids.length) return;
    await tx.$queryRaw(Prisma.sql`WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM departments WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      UNION SELECT d.id, d.parent_id FROM departments d JOIN ancestors a ON a.parent_id = d.id WHERE d.organization_id = ${organizationId}::uuid
    ) SELECT d.id FROM departments d WHERE d.organization_id = ${organizationId}::uuid AND d.id IN (SELECT id FROM ancestors)
    ORDER BY d.id ${write ? Prisma.sql`FOR UPDATE OF d` : Prisma.sql`FOR SHARE OF d`}`);
  }

  private async lockPositions(tx: AdminTransaction, organizationId: string, ids: string[], write = true) {
    const unique = [...new Set(ids)].sort();
    if (unique.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM positions WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  }

  private async lockUsers(tx: AdminTransaction, organizationId: string, ids: string[]): Promise<{ id: string }[]> {
    const userIds = [...new Set(ids)].sort();
    const budget = this.userLockBudgets.get(tx);
    if (budget && userIds.some(id => !budget.has(id))) adminError('CONCURRENCY_CONFLICT', 409);
    return userIds.length ? tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`) : [];
  }

  private async lockAssignmentRows(tx: AdminTransaction, organizationId: string, rows: { id: string; userId: string }[], write = true) {
    await this.lockUsers(tx, organizationId, rows.map(({ userId }) => userId));
    const ids = rows.map(({ id }) => id).sort();
    if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM user_positions WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  }

  private async lockAssignment(tx: AdminTransaction, organizationId: string, id: string) {
    const before = await tx.userPosition.findFirst({ where: { organizationId, id }, include: assignmentInclude });
    if (!before) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    await this.lockPositions(tx, organizationId, [before.positionId]);
    await this.lockAssignmentRows(tx, organizationId, [before]);
    const assignment = await tx.userPosition.findFirst({ where: { organizationId, id }, include: assignmentInclude });
    if (!assignment) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    return assignment;
  }

  private async refreshAccess(tx: AdminTransaction, actor: AdminActor, organizationId: string) {
    await assertRecentAuthentication(tx, actor);
    await assertAdminAccess(tx, actor, organizationId, 'organization:structure:manage');
  }

  private async assertBindingPosition(tx: AdminTransaction, organizationId: string, departmentId: string, positionId: string) {
    const position = await tx.position.findFirst({ where: { organizationId, id: positionId, departmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } } });
    if (!position) adminError('STRUCTURE_REFERENCE_INVALID', 409);
  }

  private async assertMinisterScope(tx: AdminTransaction, organizationId: string, departmentId: string, sectionDepartmentId: string, assignment: Assignment) {
    if (!await this.isDescendant(tx, organizationId, departmentId, sectionDepartmentId)) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    const bindings = await this.bindings(tx, organizationId, Prisma.sql`department_id = ${departmentId}::uuid AND responsibility = 'MINISTER' AND status = 'ACTIVE'`);
    if (bindings.length !== 1 || bindings[0]!.positionId !== assignment.positionId || assignment.position.departmentId !== departmentId
      || assignment.position.organizationId !== organizationId || assignment.position.status !== 'ACTIVE' || assignment.position.department.status !== 'ACTIVE'
      || assignment.user.organizationId !== organizationId || assignment.user.status !== 'ACTIVE' || assignment.user.accountType !== 'INTERNAL') adminError('STRUCTURE_REFERENCE_INVALID', 409);
    return bindings[0]!;
  }

  private async isDescendant(tx: AdminTransaction, organizationId: string, departmentId: string, sectionDepartmentId: string) {
    if (departmentId === sectionDepartmentId) return false;
    const seen = new Set<string>();
    let id: string | null = sectionDepartmentId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const current: { id: string; parentId: string | null } | null = await tx.department.findFirst({ where: { organizationId, id, status: 'ACTIVE' }, select: { id: true, parentId: true } });
      if (!current) return false;
      if (current.id === departmentId) return true;
      id = current.parentId;
    }
    return false;
  }

  private assertInterval(assignment: Assignment, from: Date, to: Date | null) {
    if (!Number.isFinite(from.getTime()) || (to !== null && (!Number.isFinite(to.getTime()) || to <= from))
      || from < assignment.startedAt || (assignment.endedAt !== null && (to === null || to > assignment.endedAt))) adminError('STRUCTURE_REFERENCE_INVALID', 409);
  }

  private effectiveAssignmentWhere(organizationId: string, at: Date): Prisma.UserPositionWhereInput {
    return { startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }],
      user: { organizationId, status: 'ACTIVE', accountType: 'INTERNAL' }, organization: { status: 'ACTIVE' },
    };
  }

  private assignmentResult(row: Assignment): ResponsibilityAssignmentDto {
    return { assignmentId: row.id, userId: row.userId, username: row.user.username, fullName: row.user.fullName,
      positionId: row.positionId, positionName: row.position.name, positionVersion: row.position.version,
      departmentId: row.position.departmentId, startedAt: row.startedAt, endedAt: row.endedAt,
    };
  }

  private async configurationQuery<Row>(tx: AdminTransaction, query: Prisma.Sql): Promise<Row[]> {
    try {
      return await tx.$queryRaw<Row[]>(query);
    } catch (error) {
      const metadata = (error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }).meta;
      const sqlState = metadata?.code ?? metadata?.driverAdapterError?.cause?.originalCode;
      if (sqlState === '23P01' || sqlState === '23505') adminError('CONCURRENCY_CONFLICT', 409);
      if (sqlState === '23503' || sqlState === '23514') adminError('STRUCTURE_REFERENCE_INVALID', 409);
      throw error;
    }
  }

  private bindingAudit(tx: AdminTransaction, actor: AdminActor, row: ManagementBindingDto, traceId: string, before?: ManagementBindingDto) {
    return this.audit.record({ actorUserId: actor.id, organizationId: row.organizationId, action: before ? 'MANAGEMENT_BINDING_UPDATED' : 'MANAGEMENT_BINDING_CREATED',
      resourceType: 'DepartmentManagementBinding', resourceId: row.id, outcome: 'SUCCESS', traceId,
      metadata: { departmentId: row.departmentId, responsibility: row.responsibility, positionId: row.positionId, status: row.status, resourceVersion: row.version,
        ...(before ? { previousPositionId: before.positionId, previousStatus: before.status, previousResourceVersion: before.version } : {}),
      },
    }, tx);
  }

  private scopeAudit(tx: AdminTransaction, actor: AdminActor, row: MinisterScopeDto, binding: ManagementBindingDto, traceId: string, before?: MinisterScopeDto) {
    return this.audit.record({ actorUserId: actor.id, organizationId: row.organizationId, action: before ? 'MINISTER_SCOPE_UPDATED' : 'MINISTER_SCOPE_CREATED',
      resourceType: 'DepartmentMinisterScope', resourceId: row.id, outcome: 'SUCCESS', traceId,
      metadata: { departmentId: row.departmentId, sectionDepartmentId: row.sectionDepartmentId, ministerAssignmentId: row.ministerAssignmentId,
        bindingId: binding.id, bindingVersion: binding.version, validFrom: row.validFrom.toISOString(), validTo: row.validTo?.toISOString() ?? null,
        status: row.status, resourceVersion: row.version,
        ...(before ? { previousSectionDepartmentId: before.sectionDepartmentId, previousMinisterAssignmentId: before.ministerAssignmentId,
          previousValidFrom: before.validFrom.toISOString(), previousValidTo: before.validTo?.toISOString() ?? null,
          previousStatus: before.status, previousResourceVersion: before.version } : {}),
      },
    }, tx);
  }
}
