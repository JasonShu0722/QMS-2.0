import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import {
  ComponentProjectListQueryDto, ComponentEngineerAssignmentsQueryDto, ResolveComponentProjectQueryDto,
  ComponentProjectImportDto, type ComponentProjectImportItemDto, type ComponentProjectImportResultDto,
  CreateComponentProjectRecordDto, UpdateComponentProjectRecordDto, CreateComponentProjectMappingDto, UpdateComponentProjectMappingDto,
  type ComponentProjectRecordDto, type ComponentProjectMappingDto, type ComponentProjectMappingListItemDto, type ComponentEngineerAssignmentDto, type ComponentProjectResolutionDto,
} from './component-project.dto.js';

const projectColumns = Prisma.sql`id, organization_id AS "organizationId", code, name, stage,
  customer_engineer_assignment_id AS "customerEngineerAssignmentId", project_engineer_assignment_id AS "projectEngineerAssignmentId",
  status, version, created_by_user_id AS "createdByUserId", updated_by_user_id AS "updatedByUserId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const mappingColumns = Prisma.sql`id, organization_id AS "organizationId", component_code AS "componentCode", component_name AS "componentName", project_record_id AS "projectRecordId",
  product_category AS "productCategory", product_subcategory AS "productSubcategory", status, version,
  created_by_user_id AS "createdByUserId", updated_by_user_id AS "updatedByUserId", created_at AS "createdAt", updated_at AS "updatedAt"`;
type Stored<T> = Omit<T, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type MappingPageRow = Stored<ComponentProjectMappingDto> & {
  project: Pick<ComponentProjectRecordDto, 'id' | 'code' | 'name' | 'stage' | 'status' | 'customerEngineerAssignmentId' | 'projectEngineerAssignmentId'> | null;
};
const dates = <T>(row: Stored<T>): T => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }) as T;

// Read-only organization projection: no permission/name inference and no organization writes.
const engineerSelect = {
  id: true, organizationId: true, startedAt: true, endedAt: true,
  organization: { select: { status: true, type: true } },
  user: { select: { id: true, organizationId: true, username: true, fullName: true, status: true, accountType: true } },
  position: { select: { id: true, name: true, status: true, department: { select: { id: true, name: true, status: true } } } },
} as const satisfies Prisma.UserPositionSelect;
type EngineerProjection = Prisma.UserPositionGetPayload<{ select: typeof engineerSelect }>;

function engineerIdentity(assignment: EngineerProjection | null, assignmentId: string | null, now: Date): ComponentEngineerAssignmentDto {
  const issues: string[] = [];
  if (!assignment) {
    return { assignmentId, userId: null, username: null, fullName: null, positionId: null, positionName: null, departmentId: null, departmentName: null, valid: false, issues: [assignmentId ? 'ASSIGNMENT_NOT_FOUND' : 'ENGINEER_NOT_CONFIGURED'] };
  }
  if (assignment.organization.status !== 'ACTIVE') issues.push('ORGANIZATION_DISABLED');
  if (assignment.organization.type !== 'INTERNAL' || assignment.user.accountType !== 'INTERNAL') issues.push('INTERNAL_USER_REQUIRED');
  if (assignment.user.organizationId !== assignment.organizationId) issues.push('ASSIGNMENT_ORGANIZATION_MISMATCH');
  if (assignment.user.status !== 'ACTIVE') issues.push('USER_DISABLED');
  if (assignment.startedAt > now) issues.push('ASSIGNMENT_NOT_STARTED');
  if (assignment.endedAt && assignment.endedAt <= now) issues.push('ASSIGNMENT_ENDED');
  if (assignment.position.status !== 'ACTIVE') issues.push('POSITION_DISABLED');
  if (assignment.position.department.status !== 'ACTIVE') issues.push('DEPARTMENT_DISABLED');
  return { assignmentId: assignment.id, userId: assignment.user.id, username: assignment.user.username, fullName: assignment.user.fullName,
    positionId: assignment.position.id, positionName: assignment.position.name, departmentId: assignment.position.department.id,
    departmentName: assignment.position.department.name, valid: issues.length === 0, issues };
}

export async function readComponentEngineerAssignment(transaction: AdminTransaction, organizationId: string, assignmentId: string | null, now: Date) {
  const assignment = assignmentId ? await transaction.userPosition.findFirst({ where: { id: assignmentId, organizationId }, select: engineerSelect }) : null;
  return engineerIdentity(assignment, assignmentId, now);
}

export async function listComponentEngineerAssignments(transaction: AdminTransaction, organizationId: string, query: ComponentEngineerAssignmentsQueryDto, now: Date) {
  const where: Prisma.UserPositionWhereInput = {
    organizationId, ...effectivePositionAssignmentWhere(now),
    user: { organizationId, accountType: 'INTERNAL', status: 'ACTIVE', ...(query.search ? { OR: [{ username: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] } : {}) },
  };
  const assignments = await transaction.userPosition.findMany({ where, select: engineerSelect, orderBy: [{ userId: 'asc' }, { positionId: 'asc' }, { id: 'asc' }], take: query.pageSize, skip: (query.page - 1) * query.pageSize });
  const total = await transaction.userPosition.count({ where });
  const selected = query.selectedAssignmentId ? await readComponentEngineerAssignment(transaction, organizationId, query.selectedAssignmentId, now) : null;
  return { items: assignments.map((assignment) => engineerIdentity(assignment, assignment.id, now)), total, page: query.page, pageSize: query.pageSize, selected };
}

@Injectable()
export class ComponentProjectService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService, private readonly organizations: OrganizationService) {}

  async listProjects(actor: AdminActor, organizationId: string, input: ComponentProjectListQueryDto) {
    const query = await this.input(ComponentProjectListQueryDto, input);
    return this.read(actor, organizationId, async (transaction) => {
      const filter = Prisma.sql`organization_id = ${organizationId}::uuid
        ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (strpos(lower(code), lower(${query.search})) > 0 OR strpos(lower(name), lower(${query.search})) > 0)` : Prisma.empty}`;
      const rows = await transaction.$queryRaw<Stored<ComponentProjectRecordDto>[]>(Prisma.sql`SELECT ${projectColumns} FROM component_project_records WHERE ${filter} ORDER BY code, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const [count] = await transaction.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM component_project_records WHERE ${filter}`);
      return { items: rows.map(dates<ComponentProjectRecordDto>), total: count!.total, page: query.page, pageSize: query.pageSize };
    });
  }

  async listMappings(actor: AdminActor, organizationId: string, input: ComponentProjectListQueryDto) {
    const query = await this.input(ComponentProjectListQueryDto, input);
    return this.read(actor, organizationId, async (transaction) => {
      const filter = Prisma.sql`organization_id = ${organizationId}::uuid
        ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (strpos(lower(component_code), lower(${query.search})) > 0 OR strpos(lower(component_name), lower(${query.search})) > 0 OR strpos(lower(product_category), lower(${query.search})) > 0)` : Prisma.empty}`;
      const rows = await transaction.$queryRaw<MappingPageRow[]>(Prisma.sql`
        SELECT m.*, CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'stage', p.stage, 'status', p.status,
          'customerEngineerAssignmentId', p.customer_engineer_assignment_id, 'projectEngineerAssignmentId', p.project_engineer_assignment_id) END AS project
        FROM (SELECT ${mappingColumns} FROM component_project_mappings WHERE ${filter}
          ORDER BY component_code, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}) m
        LEFT JOIN component_project_records p ON p.organization_id = m."organizationId" AND p.id = m."projectRecordId"
        ORDER BY m."componentCode", m.id`);
      const [count] = await transaction.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM component_project_mappings WHERE ${filter}`);
      const assignmentIds = [...new Set(rows.flatMap(({ project }) => project ? [project.customerEngineerAssignmentId, project.projectEngineerAssignmentId].filter((id): id is string => id !== null) : []))];
      const assignments = assignmentIds.length ? await transaction.userPosition.findMany({ where: { organizationId, id: { in: assignmentIds } }, select: engineerSelect }) : [];
      const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
      const at = new Date();
      const items = rows.map(({ project, ...mapping }) => dates<ComponentProjectMappingListItemDto>({ ...mapping,
        project: project ? { id: project.id, code: project.code, name: project.name, stage: project.stage, status: project.status,
          customerEngineer: engineerIdentity(byId.get(project.customerEngineerAssignmentId ?? '') ?? null, project.customerEngineerAssignmentId, at),
          projectEngineer: engineerIdentity(byId.get(project.projectEngineerAssignmentId ?? '') ?? null, project.projectEngineerAssignmentId, at) } : null }));
      return { items, total: count!.total, page: query.page, pageSize: query.pageSize };
    });
  }

  getProject(actor: AdminActor, organizationId: string, id: string) {
    return this.read(actor, organizationId, (transaction) => this.project(transaction, organizationId, id));
  }

  async createProject(actor: AdminActor, organizationId: string, input: CreateComponentProjectRecordDto, traceId: string, key?: string) {
    const dto = await this.input(CreateComponentProjectRecordDto, input);
    return this.mutate(actor, organizationId, 'COMPONENT_PROJECT_CREATED', dto, traceId, key, async (transaction) => {
      await this.validateEngineers(transaction, organizationId, dto);
      const id = randomUUID();
      await transaction.$executeRaw`INSERT INTO component_project_records (id, organization_id, code, name, stage, customer_engineer_assignment_id, project_engineer_assignment_id, status, created_by_user_id, updated_by_user_id)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${dto.code}, ${dto.name}, ${dto.stage}, ${dto.customerEngineerAssignmentId ?? null}::uuid, ${dto.projectEngineerAssignmentId ?? null}::uuid, ${dto.status ?? 'ACTIVE'}, ${actor.id}::uuid, ${actor.id}::uuid)`;
      const result = await this.project(transaction, organizationId, id);
      await this.record(transaction, actor, organizationId, 'COMPONENT_PROJECT_CREATED', 'ComponentProjectRecord', result, traceId);
      return result;
    });
  }

  async updateProject(actor: AdminActor, organizationId: string, id: string, input: UpdateComponentProjectRecordDto, traceId: string, key?: string) {
    const dto = await this.input(UpdateComponentProjectRecordDto, input);
    return this.mutate(actor, organizationId, 'COMPONENT_PROJECT_UPDATED', { id, ...dto }, traceId, key, async (transaction) => {
      const current = await this.project(transaction, organizationId, id);
      await this.validateEngineers(transaction, organizationId, dto);
      const count = await transaction.$executeRaw`UPDATE component_project_records SET code = ${dto.code ?? current.code}, name = ${dto.name ?? current.name}, stage = ${dto.stage ?? current.stage},
        customer_engineer_assignment_id = ${dto.customerEngineerAssignmentId === undefined ? current.customerEngineerAssignmentId : dto.customerEngineerAssignmentId}::uuid,
        project_engineer_assignment_id = ${dto.projectEngineerAssignmentId === undefined ? current.projectEngineerAssignmentId : dto.projectEngineerAssignmentId}::uuid,
        status = ${dto.status ?? current.status}, version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${dto.expectedVersion}`;
      if (count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const result = await this.project(transaction, organizationId, id);
      await this.record(transaction, actor, organizationId, 'COMPONENT_PROJECT_UPDATED', 'ComponentProjectRecord', result, traceId, current);
      return result;
    }, async (transaction) => { await this.project(transaction, organizationId, id); });
  }

  async createMapping(actor: AdminActor, organizationId: string, input: CreateComponentProjectMappingDto, traceId: string, key?: string) {
    const dto = await this.input(CreateComponentProjectMappingDto, input);
    return this.mutate(actor, organizationId, 'COMPONENT_PROJECT_MAPPING_CREATED', dto, traceId, key, async (transaction) => {
      await this.project(transaction, organizationId, dto.projectRecordId);
      const id = randomUUID();
      await transaction.$executeRaw`INSERT INTO component_project_mappings (id, organization_id, component_code, component_name, project_record_id, product_category, product_subcategory, status, created_by_user_id, updated_by_user_id)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${dto.componentCode}, ${dto.componentName ?? null}, ${dto.projectRecordId}::uuid, ${dto.productCategory}, ${dto.productSubcategory ?? null}, ${dto.status ?? 'ACTIVE'}, ${actor.id}::uuid, ${actor.id}::uuid)`;
      const result = await this.mapping(transaction, organizationId, id);
      await this.record(transaction, actor, organizationId, 'COMPONENT_PROJECT_MAPPING_CREATED', 'ComponentProjectMapping', result, traceId);
      return result;
    }, async (transaction) => { await this.project(transaction, organizationId, dto.projectRecordId); });
  }

  async importComponents(actor: AdminActor, organizationId: string, input: ComponentProjectImportDto, traceId: string, key?: string): Promise<ComponentProjectImportResultDto> {
    const dto = await this.input(ComponentProjectImportDto, input);
    if (dto.organizationId && dto.organizationId !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const authorize = async (transaction: AdminTransaction) => {
      // Lock the target scope, not just the actor's home organization, against lifecycle writes.
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
      await this.internalScope(transaction, actor, organizationId);
    };
    const mutation = (action: string, payload: object, mutationKey: string | undefined) => ({ actor, organizationId, key: mutationKey, traceId, action, payload, permission: 'component-project:manage' });
    // Reserve the exact payload before independently committing rows; changed retries cannot append work.
    await this.mutations.run(mutation('COMPONENT_PROJECT_IMPORT', { organizationId, rows: dto.rows }, key), async () => null, authorize);
    const digest = createHash('sha256').update(key!).digest('hex');
    const items: ComponentProjectImportItemDto[] = [];
    for (const row of [...dto.rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
      const result = await this.mutations.run(mutation('COMPONENT_PROJECT_IMPORT_ROW', row, `component-import:${digest}:${row.rowNumber}`), async (transaction): Promise<ComponentProjectImportItemDto> => {
        // PostgreSQL text/JSON cannot represent NUL or lone surrogates; never silently replace them.
        const code = typeof row.componentCode === 'string' && !/[\u0000\uD800-\uDFFF]/u.test(row.componentCode) ? row.componentCode.trim() : '';
        const name = typeof row.componentName === 'string' && !/[\u0000\uD800-\uDFFF]/u.test(row.componentName) ? row.componentName.trim() : '';
        if (!code || !name || [...code].length > 100 || [...name].length > 200) {
          return { rowNumber: row.rowNumber, code, status: 'FAILED', errorCode: 'COMPONENT_PROJECT_IMPORT_ROW_INVALID' };
        }
        const id = randomUUID();
        const count = await transaction.$executeRaw`INSERT INTO component_project_mappings (id, organization_id, component_code, component_name, created_by_user_id, updated_by_user_id)
          VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, ${actor.id}::uuid, ${actor.id}::uuid)
          ON CONFLICT (organization_id, component_code) DO NOTHING`;
        if (!count) return { rowNumber: row.rowNumber, code, status: 'SKIPPED_DUPLICATE' };
        await this.record(transaction, actor, organizationId, 'COMPONENT_PROJECT_MAPPING_CREATED', 'ComponentProjectMapping', await this.mapping(transaction, organizationId, id), traceId);
        return { rowNumber: row.rowNumber, code, status: 'CREATED' };
      }, authorize);
      items.push(result);
    }
    return { items, created: items.filter((item) => item.status === 'CREATED').length,
      skipped: items.filter((item) => item.status === 'SKIPPED_DUPLICATE').length, failed: items.filter((item) => item.status === 'FAILED').length };
  }

  async updateMapping(actor: AdminActor, organizationId: string, id: string, input: UpdateComponentProjectMappingDto, traceId: string, key?: string) {
    const dto = await this.input(UpdateComponentProjectMappingDto, input);
    return this.mutate(actor, organizationId, 'COMPONENT_PROJECT_MAPPING_UPDATED', { id, ...dto }, traceId, key, async (transaction) => {
      const current = await this.mapping(transaction, organizationId, id);
      const projectRecordId = dto.projectRecordId ?? current.projectRecordId;
      if (projectRecordId) await this.project(transaction, organizationId, projectRecordId);
      const count = await transaction.$executeRaw`UPDATE component_project_mappings SET component_code = ${dto.componentCode ?? current.componentCode}, project_record_id = ${projectRecordId}::uuid,
        component_name = ${dto.componentName === undefined ? current.componentName : dto.componentName},
        product_category = ${dto.productCategory ?? current.productCategory}, product_subcategory = ${dto.productSubcategory === undefined ? current.productSubcategory : dto.productSubcategory},
        status = ${dto.status ?? current.status}, version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${dto.expectedVersion}`;
      if (count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const result = await this.mapping(transaction, organizationId, id);
      await this.record(transaction, actor, organizationId, 'COMPONENT_PROJECT_MAPPING_UPDATED', 'ComponentProjectMapping', result, traceId, current);
      return result;
    }, async (transaction) => {
      await this.mapping(transaction, organizationId, id);
      if (dto.projectRecordId) await this.project(transaction, organizationId, dto.projectRecordId);
    });
  }

  async engineerAssignments(actor: AdminActor, organizationId: string, input: ComponentEngineerAssignmentsQueryDto) {
    const query = await this.input(ComponentEngineerAssignmentsQueryDto, input);
    return this.read(actor, organizationId, (transaction) => listComponentEngineerAssignments(transaction, organizationId, query, new Date()));
  }

  async resolve(actor: AdminActor, organizationId: string, input: ResolveComponentProjectQueryDto, transaction?: AdminTransaction): Promise<ComponentProjectResolutionDto> {
    const query = await this.input(ResolveComponentProjectQueryDto, input);
    return this.read(actor, organizationId, async (current) => {
      const [row] = await current.$queryRaw<Stored<ComponentProjectMappingDto>[]>(Prisma.sql`SELECT ${mappingColumns} FROM component_project_mappings WHERE organization_id = ${organizationId}::uuid AND component_code = ${query.componentCode}`);
      const mapping = row ? dates<ComponentProjectMappingDto>(row) : null;
      const project = mapping?.projectRecordId ? await this.project(current, organizationId, mapping.projectRecordId) : null;
      const now = new Date();
      const customerEngineer = await this.engineer(current, organizationId, project?.customerEngineerAssignmentId ?? null, now);
      const projectEngineer = await this.engineer(current, organizationId, project?.projectEngineerAssignmentId ?? null, now);
      const outcome = !mapping ? 'unmapped' : mapping.status !== 'ACTIVE' || (project && project.status !== 'ACTIVE') ? 'inactive' : !project || !mapping.productCategory ? 'unmapped' : 'matched';
      const applicableEngineer = project?.stage === 'NEW_PRODUCT' ? projectEngineer : customerEngineer;
      const suggestedQualityEngineerId = outcome === 'matched' && applicableEngineer.valid ? applicableEngineer.userId : null;
      const manual = query.currentQualityEngineerSource === 'MANUAL' && !!query.currentQualityEngineerId;
      const engineerDifference = !!(manual && suggestedQualityEngineerId && query.currentQualityEngineerId !== suggestedQualityEngineerId);
      return { outcome, componentCode: query.componentCode, mapping, project, customerEngineer, projectEngineer, suggestedQualityEngineerId,
        effectiveQualityEngineerId: manual ? query.currentQualityEngineerId! : suggestedQualityEngineerId, engineerDifference,
        issues: [...(!mapping ? ['MAPPING_NOT_FOUND'] : [
          ...(!project ? ['PROJECT_NOT_CONFIGURED'] : []), ...(!mapping.productCategory ? ['PRODUCT_CATEGORY_NOT_CONFIGURED'] : []),
          ...(outcome === 'inactive' ? ['MAPPING_OR_PROJECT_DISABLED'] : []),
        ]), ...(engineerDifference ? ['MANUAL_ENGINEER_DIFFERS'] : [])] };
    }, transaction);
  }

  private async project(transaction: AdminTransaction, organizationId: string, id: string): Promise<ComponentProjectRecordDto> {
    const [row] = await transaction.$queryRaw<Stored<ComponentProjectRecordDto>[]>(Prisma.sql`SELECT ${projectColumns} FROM component_project_records WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`);
    if (!row) throw new NotFoundException();
    return dates<ComponentProjectRecordDto>(row);
  }

  private async mapping(transaction: AdminTransaction, organizationId: string, id: string): Promise<ComponentProjectMappingDto> {
    const [row] = await transaction.$queryRaw<Stored<ComponentProjectMappingDto>[]>(Prisma.sql`SELECT ${mappingColumns} FROM component_project_mappings WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`);
    if (!row) throw new NotFoundException();
    return dates<ComponentProjectMappingDto>(row);
  }

  private async engineer(transaction: AdminTransaction, organizationId: string, assignmentId: string | null, now: Date) {
    return readComponentEngineerAssignment(transaction, organizationId, assignmentId, now);
  }

  private async validateEngineers(transaction: AdminTransaction, organizationId: string, dto: { customerEngineerAssignmentId?: string | null; projectEngineerAssignmentId?: string | null }) {
    const now = new Date();
    for (const id of [dto.customerEngineerAssignmentId, dto.projectEngineerAssignmentId]) {
      if (id && !(await this.engineer(transaction, organizationId, id, now)).valid) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    }
  }

  private async internalScope(transaction: AdminTransaction, actor: AdminActor, organizationId: string) {
    const organization = await this.organizations.lookup(organizationId, transaction);
    if (actor.accountType !== 'INTERNAL' || organization?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private read<T>(actor: AdminActor, organizationId: string, work: (transaction: AdminTransaction) => Promise<T>, transaction?: AdminTransaction) {
    const authorized = async (current: AdminTransaction) => {
      await assertAdminAccess(current, actor, organizationId, 'component-project:read');
      await this.internalScope(current, actor, organizationId);
      return work(current);
    };
    return transaction ? authorized(transaction) : this.prisma.$transaction(authorized, { isolationLevel: 'RepeatableRead' });
  }

  private mutate<T>(actor: AdminActor, organizationId: string, action: string, payload: object, traceId: string, key: string | undefined,
    work: (transaction: AdminTransaction) => Promise<T>, authorize?: (transaction: AdminTransaction) => Promise<void>) {
    return this.mutations.run({ actor, organizationId, permission: 'component-project:manage', action, payload: { organizationId, ...payload }, traceId, key }, async (transaction) => {
      try { return await work(transaction); }
      catch (error) {
        // Migration-owned tables use raw SQL, whose constraint errors arrive as P2010 rather than P2002.
        const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
        const code = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
        if (code === '23505') adminError('CONCURRENCY_CONFLICT', 409);
        if (code === '23503') adminError('STRUCTURE_REFERENCE_INVALID', 409);
        throw error;
      }
    }, async (transaction) => { await this.internalScope(transaction, actor, organizationId); await authorize?.(transaction); });
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceType: string,
    resource: ComponentProjectRecordDto | ComponentProjectMappingDto, traceId: string, previous?: ComponentProjectRecordDto | ComponentProjectMappingDto) {
    const values = (record: ComponentProjectRecordDto | ComponentProjectMappingDto): Record<string, string | null> => 'code' in record
      ? { componentProjectCode: record.code, componentProjectName: record.name, componentProjectStage: record.stage,
        customerEngineerAssignmentId: record.customerEngineerAssignmentId, projectEngineerAssignmentId: record.projectEngineerAssignmentId, status: record.status }
      : { componentCode: record.componentCode, componentName: record.componentName, projectRecordId: record.projectRecordId, productCategory: record.productCategory,
        productSubcategory: record.productSubcategory, status: record.status };
    const before = previous ? Object.fromEntries(Object.entries(values(previous)).map(([field, value]) => [`previous${field[0]!.toUpperCase()}${field.slice(1)}`, value])) : {};
    const metadata = { resourceVersion: resource.version, ...('code' in resource ? { componentProjectId: resource.id } : {}), ...values(resource), ...before };
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType, resourceId: resource.id, outcome: 'SUCCESS', traceId, metadata }, transaction);
  }

  private async input<T extends object>(Dto: ClassConstructor<T>, input: T): Promise<T> {
    const dto = plainToInstance(Dto, input);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) throw new BadRequestException();
    return dto;
  }
}
