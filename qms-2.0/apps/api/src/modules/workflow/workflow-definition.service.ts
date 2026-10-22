import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type WorkflowDefinition, type WorkflowVersion } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ACTIVE_PERMISSION_CODES } from '../authorization/permission-catalog.js';
import { assertWorkflowFeature, type WorkflowActor } from './workflow-access-policy.js';
import { workflowError } from './workflow-runtime-policy.js';
import { WorkflowValidationService, type WorkflowDraft } from './workflow-validation.service.js';
import type { WorkflowDefinitionDetailDto, WorkflowDefinitionHeaderDto, WorkflowDefinitionResponseDto, WorkflowGraphResponseDto, WorkflowOptionsDto, WorkflowOptionsQueryDto, WorkflowPageDto, WorkflowQueryDto, WorkflowVersionResponseDto, WorkflowVersionSummaryDto } from './workflow.dto.js';

interface WorkflowManagementContext { organizationId: string; userId?: string; traceId?: string; actor?: WorkflowActor }
interface CreateInput extends WorkflowManagementContext { code: string; name: string; description?: string; draft: WorkflowDraft }
interface VersionInput extends WorkflowManagementContext { definitionId: string; expectedRevision?: number; draftVersionId?: string }
interface UpdateInput extends VersionInput { description?: string; draft: WorkflowDraft }
interface PublishInput extends VersionInput { changeNote?: string }
interface CopyInput extends WorkflowManagementContext { definitionId: string; expectedRevision?: number; sourceVersionId?: string; description?: string }
type IncludedVersion = Prisma.WorkflowVersionGetPayload<{ include: { nodes: true; transitions: true } }>;

@Injectable()
export class WorkflowDefinitionService {
  constructor(private readonly prisma: PrismaService, private readonly validation: WorkflowValidationService, private readonly audit: AuditLogService) {}

  async createDraft(input: CreateInput): Promise<WorkflowDefinitionResponseDto> {
    this.checkText(input.code, 100);
    this.checkText(input.name, 200);
    this.checkOptionalText(input.description, 1000);
    const graph = this.validation.normalizeDraft(input.draft);
    return this.transaction(async (tx) => {
      await this.access(tx, input);
      const definition = await tx.workflowDefinition.create({ data: {
        organizationId: input.organizationId, code: input.code.trim(), name: input.name.trim(), description: input.description?.trim() ?? null,
        createdById: input.userId ?? null, updatedById: input.userId ?? null,
      } });
      const version = await tx.workflowVersion.create({ data: {
        organizationId: input.organizationId, workflowDefinitionId: definition.id, version: 1, status: 'DRAFT',
        createdById: input.userId ?? null, updatedById: input.userId ?? null, structureSnapshot: this.json(graph),
      } });
      await this.writeGraph(tx, input.organizationId, version.id, graph, input.userId);
      await this.record(tx, input, 'WORKFLOW_DRAFT_CREATED', 'WorkflowDefinition', definition.id, 'DRAFT', 1);
      return this.response(tx, definition, version.id);
    });
  }

  async updateDraft(input: UpdateInput): Promise<WorkflowDefinitionResponseDto> {
    this.checkOptionalText(input.description, 1000);
    const graph = this.validation.normalizeDraft(input.draft);
    return this.transaction(async (tx) => {
      const definition = await this.lockDefinition(tx, input);
      const version = await this.lockDraft(tx, input);
      await this.access(tx, input);
      this.assertRevision(input, definition.version);
      if (version.status !== 'DRAFT') throw new ConflictException({ code: 'WORKFLOW_VERSION_IMMUTABLE' });
      await tx.workflowTransition.deleteMany({ where: { organizationId: input.organizationId, workflowVersionId: version.id } });
      await tx.workflowNode.deleteMany({ where: { organizationId: input.organizationId, workflowVersionId: version.id } });
      await this.writeGraph(tx, input.organizationId, version.id, graph, input.userId);
      await tx.workflowVersion.update({ where: { id: version.id }, data: { structureSnapshot: this.json(graph), updatedById: input.userId ?? null } });
      const updated = await this.advanceDefinition(tx, definition, input);
      await this.record(tx, input, 'WORKFLOW_DRAFT_UPDATED', 'WorkflowDefinition', definition.id, 'DRAFT', updated.version);
      return this.response(tx, updated, version.id);
    });
  }

  async publishVersion(input: PublishInput): Promise<WorkflowVersionResponseDto> {
    return (await this.publishDefinition(input)).version;
  }

  async publishDefinition(input: PublishInput): Promise<WorkflowDefinitionResponseDto> {
    this.checkOptionalText(input.changeNote, 500);
    return this.transaction(async (tx) => {
      const definition = await this.lockDefinition(tx, input);
      const draft = await this.lockDraft(tx, input);
      await this.access(tx, input);
      this.assertRevision(input, definition.version);
      if (draft.status !== 'DRAFT') throw new ConflictException({ code: 'WORKFLOW_VERSION_IMMUTABLE' });
      const graph = this.graphFromIncluded(draft);
      this.validation.assertValid(graph);
      await tx.workflowVersion.update({ where: { id: draft.id }, data: {
        status: 'PUBLISHED', publishedAt: new Date(), publishedById: input.userId ?? null,
        changeNote: input.changeNote?.trim() ?? null, structureSnapshot: this.json(graph), updatedById: input.userId ?? null,
      } });
      const updated = await this.advanceDefinition(tx, definition, input);
      await this.record(tx, input, 'WORKFLOW_VERSION_PUBLISHED', 'WorkflowVersion', draft.id, 'PUBLISHED', draft.version);
      return this.response(tx, updated, draft.id);
    });
  }

  async copyPublishedVersion(input: CopyInput): Promise<WorkflowDefinitionResponseDto> {
    this.checkOptionalText(input.description, 1000);
    return this.transaction(async (tx) => {
      const definition = await this.lockDefinition(tx, input);
      if (input.actor && !input.sourceVersionId) throw new BadRequestException();
      const source = await tx.workflowVersion.findFirst({
        where: { organizationId: input.organizationId, workflowDefinitionId: definition.id, ...(input.sourceVersionId ? { id: input.sourceVersionId } : {}), status: 'PUBLISHED' },
        orderBy: { version: 'desc' }, include: { nodes: true, transitions: true },
      });
      if (source) await tx.$queryRaw`SELECT id FROM workflow_versions WHERE id = ${source.id}::uuid FOR UPDATE`;
      await this.access(tx, input);
      this.assertRevision(input, definition.version);
      if (!source) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
      if (await tx.workflowVersion.count({ where: { workflowDefinitionId: definition.id, status: 'DRAFT' } })) workflowError('CONCURRENCY_CONFLICT', 409);
      const graph = this.validation.normalizeDraft(this.graphFromIncluded(source));
      const latest = await tx.workflowVersion.aggregate({ where: { workflowDefinitionId: definition.id }, _max: { version: true } });
      const version = await tx.workflowVersion.create({ data: {
        organizationId: input.organizationId, workflowDefinitionId: definition.id, version: (latest._max.version ?? 0) + 1,
        status: 'DRAFT', createdById: input.userId ?? null, updatedById: input.userId ?? null, structureSnapshot: this.json(graph),
      } });
      await this.writeGraph(tx, input.organizationId, version.id, graph, input.userId);
      const updated = await this.advanceDefinition(tx, definition, input);
      await this.record(tx, input, 'WORKFLOW_VERSION_COPIED', 'WorkflowDefinition', definition.id, 'DRAFT', updated.version);
      return this.response(tx, updated, version.id);
    });
  }

  async validateDraft(organizationId: string, definitionId: string, actor?: WorkflowActor) {
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId, actor, userId: actor?.id });
      const version = await tx.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definitionId, status: 'DRAFT' }, include: { nodes: true, transitions: true } });
      if (!version) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
      return this.validation.validateDraft(this.graphFromIncluded(version));
    });
  }

  async validateGraph(actor: WorkflowActor, draft: WorkflowDraft) {
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId: actor.organizationId, userId: actor.id, actor });
      return this.validation.validateDraft(draft);
    });
  }

  async list(actor: WorkflowActor, query: WorkflowQueryDto): Promise<WorkflowPageDto> {
    const pageSize = query.pageSize ?? 25;
    const offset = query.offset ?? 0;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BadRequestException();
    this.checkOptionalText(query.search, 100);
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId: actor.organizationId, userId: actor.id, actor });
      const search = query.search?.trim();
      const match = search ? Prisma.sql`AND (position(lower(${search}) in lower(definition.code)) > 0 OR position(lower(${search}) in lower(definition.name)) > 0)` : Prisma.empty;
      const status = query.status ? Prisma.sql`AND latest.status::text = ${query.status}` : Prisma.empty;
      const [page] = await tx.$queryRaw<{ total: number; ids: string[] }[]>(Prisma.sql`
        WITH matches AS MATERIALIZED (
          SELECT definition.id, definition.created_at FROM workflow_definitions definition
          JOIN LATERAL (SELECT status FROM workflow_versions WHERE workflow_definition_id = definition.id ORDER BY version DESC LIMIT 1) latest ON true
          WHERE definition.organization_id = ${actor.organizationId}::uuid ${match} ${status}
        ) SELECT (SELECT count(*)::int FROM matches) AS total,
          ARRAY(SELECT id FROM matches ORDER BY created_at DESC, id DESC LIMIT ${pageSize} OFFSET ${offset}) AS ids`);
      const definitions = await tx.workflowDefinition.findMany({ where: { id: { in: page!.ids }, organizationId: actor.organizationId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      return { total: page!.total, items: page!.ids.map((id) => {
        const definition = definitions.find((entry) => entry.id === id)!;
        const version = definition.versions[0]!;
        return { ...this.header(definition), version: this.versionSummary(version), draftVersionId: version.status === 'DRAFT' ? version.id : null };
      }) };
    }, 'RepeatableRead');
  }

  async detail(actor: WorkflowActor, definitionId: string): Promise<WorkflowDefinitionDetailDto> {
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId: actor.organizationId, userId: actor.id, actor });
      const definition = await tx.workflowDefinition.findFirst({ where: { id: definitionId, organizationId: actor.organizationId }, include: { versions: { orderBy: { version: 'desc' } } } });
      if (!definition) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
      return { ...this.header(definition), versions: definition.versions.map((version) => this.versionSummary(version)) };
    }, 'RepeatableRead');
  }

  async version(actor: WorkflowActor, definitionId: string, versionId: string): Promise<WorkflowDefinitionResponseDto> {
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId: actor.organizationId, userId: actor.id, actor });
      const definition = await tx.workflowDefinition.findFirst({ where: { id: definitionId, organizationId: actor.organizationId } });
      if (!definition) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
      return this.response(tx, definition, versionId);
    }, 'RepeatableRead');
  }

  async options(actor: WorkflowActor, query: WorkflowOptionsQueryDto): Promise<WorkflowOptionsDto> {
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException();
    this.checkOptionalText(query.search, 100);
    return this.transaction(async (tx) => {
      await this.access(tx, { organizationId: actor.organizationId, userId: actor.id, actor });
      const search = query.search?.trim();
      const textFilter = search ? { OR: [{ code: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }] } : {};
      const roleTextFilter = search ? { OR: [...textFilter.OR!, { positions: { some: { isCanonical: true, position: { name: { contains: search, mode: 'insensitive' as const } } } } }] } : {};
      const [roles, users, permissions] = await Promise.all([
        tx.role.findMany({ where: { AND: [{ OR: [{ organizationId: actor.organizationId }, { organizationId: null }] }, roleTextFilter] }, select: { code: true, name: true, positions: { where: { isCanonical: true }, select: { position: { select: { name: true } } }, take: 1 } }, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: limit }),
        tx.user.findMany({ where: { organizationId: actor.organizationId, status: 'ACTIVE', ...(search ? { username: { contains: search, mode: 'insensitive' as const } } : {}) }, select: { id: true, username: true }, orderBy: [{ username: 'asc' }, { id: 'asc' }], take: limit }),
        tx.permission.findMany({ where: { code: { in: ACTIVE_PERMISSION_CODES }, ...textFilter }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      ]);
      return { roles: roles.map(({ code, name, positions }) => ({ code, name: positions[0]?.position.name ?? name })), users: users.map((user) => ({ id: user.id, name: user.username })), permissions };
    }, 'RepeatableRead');
  }

  private async lockDefinition(tx: Prisma.TransactionClient, input: VersionInput | CopyInput): Promise<WorkflowDefinition> {
    await tx.$queryRaw`SELECT id FROM workflow_definitions WHERE id = ${input.definitionId}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
    const definition = await tx.workflowDefinition.findFirst({ where: { id: input.definitionId, organizationId: input.organizationId } });
    if (!definition) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
    return definition;
  }

  private async lockDraft(tx: Prisma.TransactionClient, input: VersionInput): Promise<IncludedVersion> {
    if (input.actor && !input.draftVersionId) throw new BadRequestException();
    const candidate = await tx.workflowVersion.findFirst({ where: { organizationId: input.organizationId, workflowDefinitionId: input.definitionId, ...(input.draftVersionId ? { id: input.draftVersionId } : {}) }, orderBy: { version: 'desc' } });
    if (!candidate) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM workflow_versions WHERE id = ${candidate.id}::uuid FOR UPDATE`;
    const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: candidate.id }, include: { nodes: true, transitions: true } });
    return version;
  }

  private async access(tx: Prisma.TransactionClient, input: WorkflowManagementContext): Promise<void> {
    if (!input.actor) return;
    if (input.actor.organizationId !== input.organizationId || input.userId !== input.actor.id) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertActiveAuthentication(tx, input.actor);
    await assertWorkflowFeature(tx, input.actor, input.organizationId, 'workflow:manage');
  }

  private assertRevision(input: { actor?: WorkflowActor; expectedRevision?: number }, actual: number) {
    if (input.actor && input.expectedRevision === undefined) throw new BadRequestException();
    if (input.expectedRevision !== undefined && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)) throw new BadRequestException();
    if (input.expectedRevision !== undefined && input.expectedRevision !== actual) workflowError('CONCURRENCY_CONFLICT', 409);
  }

  private async advanceDefinition(tx: Prisma.TransactionClient, definition: WorkflowDefinition, input: WorkflowManagementContext & { description?: string }) {
    const changed = await tx.workflowDefinition.updateMany({ where: { id: definition.id, organizationId: definition.organizationId, version: definition.version }, data: { version: { increment: 1 }, updatedById: input.userId ?? null, ...(input.description !== undefined ? { description: input.description.trim() } : {}) } });
    if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    return tx.workflowDefinition.findUniqueOrThrow({ where: { id: definition.id } });
  }

  private async writeGraph(tx: Prisma.TransactionClient, organizationId: string, versionId: string, draft: WorkflowDraft, userId?: string) {
    const nodeIds = new Map<string, string>();
    for (const node of draft.nodes) {
      const id = randomUUID();
      nodeIds.set(node.id, id);
      await tx.workflowNode.create({ data: { id, organizationId, workflowVersionId: versionId, nodeKey: node.id, type: node.type as Prisma.WorkflowNodeCreateInput['type'], name: node.name!, config: this.json(node.config ?? {}), createdById: userId ?? null, updatedById: userId ?? null } });
    }
    for (const edge of draft.transitions) await tx.workflowTransition.create({ data: { organizationId, workflowVersionId: versionId, transitionKey: edge.id, action: edge.action ?? null, fromNodeId: nodeIds.get(edge.from)!, toNodeId: nodeIds.get(edge.to)!, condition: this.json(edge.condition ?? {}), createdById: userId ?? null, updatedById: userId ?? null } });
  }

  private graphFromIncluded(version: IncludedVersion): WorkflowDraft {
    const keys = new Map(version.nodes.map((node) => [node.id, node.nodeKey]));
    return {
      nodes: version.nodes.map((node) => ({ id: node.nodeKey, type: node.type, name: node.name, config: Object.fromEntries(Object.entries((node.config ?? {}) as Record<string, unknown>).map(([key, value]) => [key, ['assignment', 'escalation'].includes(key) && typeof value === 'string' ? { roleCode: value } : value])) })),
      transitions: version.transitions.map((edge) => ({ id: edge.transitionKey, from: keys.get(edge.fromNodeId)!, to: keys.get(edge.toNodeId)!, ...(edge.action ? { action: edge.action } : {}), ...(edge.condition && Object.keys(edge.condition).length ? { condition: edge.condition as Record<string, unknown> } : {}) })),
    };
  }

  private header(definition: WorkflowDefinition): WorkflowDefinitionHeaderDto {
    return { id: definition.id, organizationId: definition.organizationId, code: definition.code, name: definition.name, description: definition.description, revision: definition.version };
  }

  private versionSummary(version: WorkflowVersion): WorkflowVersionSummaryDto {
    return { id: version.id, workflowDefinitionId: version.workflowDefinitionId, version: version.version, status: version.status, publishedAt: version.publishedAt?.toISOString() ?? null, publishedById: version.publishedById, changeNote: version.changeNote };
  }

  private async response(tx: Prisma.TransactionClient, definition: WorkflowDefinition, versionId: string): Promise<WorkflowDefinitionResponseDto> {
    const version = await tx.workflowVersion.findFirst({ where: { id: versionId, organizationId: definition.organizationId, workflowDefinitionId: definition.id }, include: { nodes: { orderBy: { nodeKey: 'asc' } }, transitions: { orderBy: { transitionKey: 'asc' } } } });
    if (!version) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
    return { ...this.header(definition), version: { ...this.versionSummary(version), structureSnapshot: this.graphFromIncluded(version) as WorkflowGraphResponseDto } };
  }

  private async record(tx: Prisma.TransactionClient, input: WorkflowManagementContext, action: string, resourceType: string, resourceId: string, status: string, version: number) {
    await this.audit.record({ organizationId: input.organizationId, actorUserId: input.userId, action, resourceType, resourceId, outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(), metadata: { organizationId: input.organizationId, status, resourceVersion: version } }, tx);
  }

  private json(value: unknown): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject; }
  private checkText(value: unknown, length: number) { if (typeof value !== 'string' || !value.trim() || value.length > length) throw new BadRequestException(); }
  private checkOptionalText(value: unknown, length: number) { if (value !== undefined && (typeof value !== 'string' || value.length > length)) throw new BadRequestException(); }

  private async transaction<Result>(work: (tx: Prisma.TransactionClient) => Promise<Result>, isolationLevel: 'ReadCommitted' | 'RepeatableRead' = 'ReadCommitted'): Promise<Result> {
    try { return await this.prisma.$transaction(work, { isolationLevel }); }
    catch (error) {
      if (['P2002', 'P2034'].includes(String((error as { code?: string }).code))) workflowError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }
}
