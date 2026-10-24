import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { readComponentEngineerAssignment } from './component-project.service.js';
import type { ComponentProjectRecordDto, ComponentProjectMappingDto } from './component-project.dto.js';
import { ComponentProjectBulkApplyDto, ComponentProjectBulkPreviewDto, type ComponentProjectBulkChangesDto, type ComponentProjectBulkPreviewResultDto, type ComponentProjectBulkApplyResultDto } from './component-project-bulk.dto.js';

const sharedFields = ['stage', 'customerEngineerAssignmentId', 'projectEngineerAssignmentId'] as const;
type Project = Pick<ComponentProjectRecordDto, 'id' | 'organizationId' | 'code' | 'name' | 'stage' | 'status' | 'version' | 'customerEngineerAssignmentId' | 'projectEngineerAssignmentId'>;
type Mapping = Pick<ComponentProjectMappingDto, 'id' | 'organizationId' | 'componentCode' | 'componentName' | 'projectRecordId' | 'productCategory' | 'productSubcategory' | 'status' | 'version'>;
const projectColumns = Prisma.sql`id, organization_id AS "organizationId", code, name, stage, status, version,
  customer_engineer_assignment_id AS "customerEngineerAssignmentId", project_engineer_assignment_id AS "projectEngineerAssignmentId"`;
const mappingColumns = Prisma.sql`id, organization_id AS "organizationId", component_code AS "componentCode", component_name AS "componentName",
  project_record_id AS "projectRecordId", product_category AS "productCategory", product_subcategory AS "productSubcategory", status, version`;
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const projectChanged = (project: Project, changes: ComponentProjectBulkChangesDto) => sharedFields.some((field) => changes[field] !== undefined && changes[field] !== project[field]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function buildComponentProjectBulkPreview(organizationId: string, dto: ComponentProjectBulkPreviewDto, mappings: Mapping[], projects: Project[], members: Mapping[]): ComponentProjectBulkPreviewResultDto {
  const selectedIds = new Set(dto.selection.map(({ id }) => id));
  for (const selected of dto.selection) {
    const mapping = mappings.find(({ id }) => id === selected.id);
    if (!mapping) throw new NotFoundException();
    if (mapping.version !== selected.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
  }
  const sharedEdit = sharedFields.some((field) => dto.changes[field] !== undefined);
  const finalProjects = new Map<string, number>();
  for (const mapping of mappings) {
    const projectId = dto.changes.projectRecordId ?? mapping.projectRecordId;
    if (sharedEdit && !projectId) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    if (projectId) finalProjects.set(projectId, (finalProjects.get(projectId) ?? 0) + 1);
  }
  const affectedProjects = [...finalProjects.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, selectedComponentCount]) => {
    const project = projects.find((entry) => entry.id === id);
    if (!project) throw new NotFoundException();
    const otherComponentCount = members.filter((mapping) => mapping.projectRecordId === id && !selectedIds.has(mapping.id)).length;
    return { id, code: project.code, name: project.name, stage: project.stage, status: project.status, version: project.version, selectedComponentCount, totalComponentCount: selectedComponentCount + otherComponentCount, otherComponentCount };
  });
  const changedProjects = new Set(affectedProjects.filter((summary) => projectChanged(projects.find(({ id }) => id === summary.id)!, dto.changes)).map(({ id }) => id));
  const affected = new Set<string>();
  for (const mapping of mappings) {
    const finalProjectId = dto.changes.projectRecordId ?? mapping.projectRecordId;
    if ((dto.changes.projectRecordId !== undefined && dto.changes.projectRecordId !== mapping.projectRecordId)
      || (dto.changes.productCategory !== undefined && dto.changes.productCategory !== mapping.productCategory)
      || (dto.changes.productSubcategory !== undefined && dto.changes.productSubcategory !== mapping.productSubcategory)
      || (finalProjectId && changedProjects.has(finalProjectId))) affected.add(mapping.id);
  }
  for (const member of members) {
    if (!selectedIds.has(member.id) && member.projectRecordId && changedProjects.has(member.projectRecordId)) affected.add(member.id);
  }
  const snapshot = { schema: 'component-project-bulk:v1', organizationId, selection: byId(dto.selection), changes: dto.changes,
    projects: byId(projects), members: byId(members).map(({ id, version, projectRecordId }) => ({ id, version, projectRecordId })) };
  return { selectedCount: dto.selection.length, affectedMappingsCount: affected.size, affectedProjects,
    previewToken: createHash('sha256').update(canonical(snapshot)).digest('hex') };
}

@Injectable()
export class ComponentProjectBulkService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly organizations: OrganizationService) {}

  async preview(actor: AdminActor, organizationId: string, input: ComponentProjectBulkPreviewDto): Promise<ComponentProjectBulkPreviewResultDto> {
    const dto = await this.input(ComponentProjectBulkPreviewDto, input, organizationId);
    return this.prisma.$transaction(async (transaction) => {
      await this.authorize(transaction, actor, organizationId);
      return (await this.snapshot(transaction, organizationId, dto, false)).preview;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async apply(actor: AdminActor, organizationId: string, input: ComponentProjectBulkApplyDto, traceId: string, key?: string): Promise<ComponentProjectBulkApplyResultDto> {
    const dto = await this.input(ComponentProjectBulkApplyDto, input, organizationId);
    return this.mutations.run({ actor, organizationId, permission: 'component-project:manage', action: 'COMPONENT_PROJECT_BULK_UPDATED',
      payload: { organizationId, selection: byId(dto.selection), changes: dto.changes, previewToken: dto.previewToken }, traceId, key, isolationLevel: 'Serializable' }, async (transaction) => {
      try {
        const snapshot = await this.snapshot(transaction, organizationId, dto, true);
        if (snapshot.preview.previewToken !== dto.previewToken) adminError('CONCURRENCY_CONFLICT', 409);
        let updatedMappingCount = 0;
        let updatedProjectCount = 0;
        const affected = new Set<string>();
        for (const current of byId(snapshot.mappings)) {
          const next: Mapping = { ...current, projectRecordId: dto.changes.projectRecordId ?? current.projectRecordId,
            productCategory: dto.changes.productCategory ?? current.productCategory,
            productSubcategory: dto.changes.productSubcategory === undefined ? current.productSubcategory : dto.changes.productSubcategory };
          if (next.projectRecordId === current.projectRecordId && next.productCategory === current.productCategory && next.productSubcategory === current.productSubcategory) continue;
          const count = await transaction.$executeRaw`UPDATE component_project_mappings SET project_record_id = ${next.projectRecordId}::uuid,
            product_category = ${next.productCategory}, product_subcategory = ${next.productSubcategory}, version = version + 1,
            updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ${organizationId}::uuid AND id = ${current.id}::uuid AND version = ${current.version}`;
          if (count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
          next.version++;
          await this.record(transaction, actor, organizationId, next, current, traceId);
          updatedMappingCount++;
          affected.add(current.id);
        }
        for (const summary of snapshot.preview.affectedProjects) {
          const current = snapshot.projects.find(({ id }) => id === summary.id)!;
          if (!projectChanged(current, dto.changes)) continue;
          const next: Project = { ...current, stage: dto.changes.stage ?? current.stage,
            customerEngineerAssignmentId: dto.changes.customerEngineerAssignmentId === undefined ? current.customerEngineerAssignmentId : dto.changes.customerEngineerAssignmentId,
            projectEngineerAssignmentId: dto.changes.projectEngineerAssignmentId === undefined ? current.projectEngineerAssignmentId : dto.changes.projectEngineerAssignmentId };
          const count = await transaction.$executeRaw`UPDATE component_project_records SET stage = ${next.stage},
            customer_engineer_assignment_id = ${next.customerEngineerAssignmentId}::uuid, project_engineer_assignment_id = ${next.projectEngineerAssignmentId}::uuid,
            version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ${organizationId}::uuid AND id = ${current.id}::uuid AND version = ${current.version}`;
          if (count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
          next.version++;
          await this.record(transaction, actor, organizationId, next, current, traceId);
          updatedProjectCount++;
          for (const mapping of snapshot.members) {
            const finalProjectId = snapshot.mappings.some(({ id }) => id === mapping.id) ? dto.changes.projectRecordId ?? mapping.projectRecordId : mapping.projectRecordId;
            if (finalProjectId === current.id) affected.add(mapping.id);
          }
          // An incoming unmapped selection is not in the project's previous membership.
          for (const mapping of snapshot.mappings) if ((dto.changes.projectRecordId ?? mapping.projectRecordId) === current.id) affected.add(mapping.id);
        }
        await this.audit.record({ actorUserId: actor.id, organizationId, action: 'COMPONENT_PROJECT_BULK_UPDATED', resourceType: 'ComponentProjectMapping', outcome: 'SUCCESS', traceId,
          metadata: { sha256: dto.previewToken } }, transaction);
        return { updatedMappingCount, updatedProjectCount, affectedComponentCount: affected.size };
      } catch (error) {
        const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
        const code = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
        if (code === '23503') adminError('STRUCTURE_REFERENCE_INVALID', 409);
        if (code === '22003' || code === '23505') adminError('CONCURRENCY_CONFLICT', 409);
        throw error;
      }
    }, async (transaction) => {
      // Scope lifecycle locks precede project/mapping locks, including idempotent replay.
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
      await this.authorize(transaction, actor, organizationId);
    });
  }

  private async snapshot(transaction: AdminTransaction, organizationId: string, dto: ComponentProjectBulkPreviewDto, lock: boolean) {
    const ids = dto.selection.map(({ id }) => id);
    const selected = await transaction.$queryRaw<Mapping[]>(Prisma.sql`SELECT ${mappingColumns} FROM component_project_mappings
      WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id`);
    if (selected.length !== ids.length) throw new NotFoundException();
    const projectIds = [...new Set([...selected.map(({ projectRecordId }) => projectRecordId).filter((id): id is string => !!id), ...(dto.changes.projectRecordId ? [dto.changes.projectRecordId] : [])])].sort();
    const projects = projectIds.length ? await transaction.$queryRaw<Project[]>(Prisma.sql`SELECT ${projectColumns} FROM component_project_records
      WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`) : [];
    const allMappings = await transaction.$queryRaw<Mapping[]>(Prisma.sql`SELECT ${mappingColumns} FROM component_project_mappings
      WHERE organization_id = ${organizationId}::uuid AND (id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ${projectIds.length ? Prisma.sql`OR project_record_id IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty})
      ORDER BY id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    const selectedIds = new Set(ids);
    const mappings = allMappings.filter(({ id }) => selectedIds.has(id));
    const members = allMappings.filter(({ projectRecordId }) => projectRecordId !== null);
    const preview = buildComponentProjectBulkPreview(organizationId, dto, mappings, projects, members);
    const now = new Date();
    for (const id of new Set([dto.changes.customerEngineerAssignmentId, dto.changes.projectEngineerAssignmentId])) {
      if (id && !(await readComponentEngineerAssignment(transaction, organizationId, id, now)).valid) adminError('STRUCTURE_REFERENCE_INVALID', 409);
    }
    return { mappings, projects, members, preview };
  }

  private async authorize(transaction: AdminTransaction, actor: AdminActor, organizationId: string) {
    await assertAdminAccess(transaction, actor, organizationId, 'component-project:manage');
    if (actor.accountType !== 'INTERNAL' || (await this.organizations.lookup(organizationId, transaction))?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, resource: Project | Mapping, previous: Project | Mapping, traceId: string) {
    const values = (row: Project | Mapping): Record<string, string | null> => 'code' in row
      ? { componentProjectCode: row.code, componentProjectName: row.name, componentProjectStage: row.stage,
        customerEngineerAssignmentId: row.customerEngineerAssignmentId, projectEngineerAssignmentId: row.projectEngineerAssignmentId, status: row.status }
      : { componentCode: row.componentCode, componentName: row.componentName, projectRecordId: row.projectRecordId,
        productCategory: row.productCategory, productSubcategory: row.productSubcategory, status: row.status };
    const before = Object.fromEntries(Object.entries(values(previous)).map(([field, value]) => [`previous${field[0]!.toUpperCase()}${field.slice(1)}`, value]));
    const project = 'code' in resource;
    return this.audit.record({ actorUserId: actor.id, organizationId, action: project ? 'COMPONENT_PROJECT_UPDATED' : 'COMPONENT_PROJECT_MAPPING_UPDATED',
      resourceType: project ? 'ComponentProjectRecord' : 'ComponentProjectMapping', resourceId: resource.id, outcome: 'SUCCESS', traceId,
      metadata: { resourceVersion: resource.version, previousResourceVersion: previous.version, ...(project ? { componentProjectId: resource.id } : {}), ...values(resource), ...before } }, transaction);
  }

  private async input<T extends ComponentProjectBulkPreviewDto>(Dto: ClassConstructor<T>, input: T, organizationId: string): Promise<T> {
    if (!isUUID(organizationId) || !input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException();
    const dto = plainToInstance(Dto, input);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) throw new BadRequestException();
    return dto;
  }
}
