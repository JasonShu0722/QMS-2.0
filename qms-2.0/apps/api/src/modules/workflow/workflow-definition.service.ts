import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { WorkflowValidationService, type WorkflowDraft } from './workflow-validation.service.js';

interface WorkflowActor { organizationId: string; userId?: string; traceId?: string }
interface CreateInput extends WorkflowActor { code: string; name: string; description?: string; draft: WorkflowDraft }
interface UpdateInput extends WorkflowActor { definitionId: string; description?: string; draft: WorkflowDraft }

@Injectable()
export class WorkflowDefinitionService {
  constructor(private readonly prisma: PrismaService, private readonly validation: WorkflowValidationService, private readonly audit: AuditLogService) {}

  async createDraft(input: CreateInput): Promise<Record<string, unknown>> {
    this.validation.assertValid(input.draft);
    const result = await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.create({ data: {
        organizationId: input.organizationId, code: input.code.trim(), name: input.name.trim(), description: input.description?.trim() ?? null,
        createdById: input.userId ?? null, updatedById: input.userId ?? null,
      } });
      const version = await tx.workflowVersion.create({ data: {
        organizationId: input.organizationId, workflowDefinitionId: definition.id, version: 1, status: 'DRAFT',
        createdById: input.userId ?? null, updatedById: input.userId ?? null,
        structureSnapshot: input.draft as never,
      } });
      await this.writeGraph(tx, input.organizationId, version.id, input.draft, input.userId);
      return { ...definition, version: await this.readVersion(tx, version.id) };
    });
    await this.audit.record({ organizationId: input.organizationId, actorUserId: input.userId, action: 'WORKFLOW_DRAFT_CREATED', resourceType: 'WorkflowDefinition', resourceId: String(result.id), outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(), metadata: { organizationId: input.organizationId, status: 'DRAFT' } });
    return result;
  }

  async updateDraft(input: UpdateInput): Promise<Record<string, unknown>> {
    this.validation.assertValid(input.draft);
    const result = await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.findFirst({ where: { id: input.definitionId, organizationId: input.organizationId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!definition) throw new NotFoundException('WORKFLOW_NOT_FOUND');
      const version = definition.versions[0];
      if (!version) throw new NotFoundException('WORKFLOW_DRAFT_NOT_FOUND');
      if (version.status !== 'DRAFT') throw new ConflictException('WORKFLOW_VERSION_IMMUTABLE');
      await tx.workflowTransition.deleteMany({ where: { organizationId: input.organizationId, workflowVersionId: version.id } });
      await tx.workflowNode.deleteMany({ where: { organizationId: input.organizationId, workflowVersionId: version.id } });
      await this.writeGraph(tx, input.organizationId, version.id, input.draft, input.userId);
      await tx.workflowVersion.update({ where: { id: version.id }, data: { structureSnapshot: input.draft as never, updatedById: input.userId ?? null } });
      if (input.description !== undefined) await tx.workflowDefinition.update({ where: { id: definition.id }, data: { description: input.description, updatedById: input.userId ?? null } });
      return { ...definition, version: await this.readVersion(tx, version.id) };
    });
    await this.audit.record({ organizationId: input.organizationId, actorUserId: input.userId, action: 'WORKFLOW_DRAFT_UPDATED', resourceType: 'WorkflowDefinition', resourceId: input.definitionId, outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(), metadata: { organizationId: input.organizationId, status: 'DRAFT' } });
    return result;
  }

  async validateDraft(organizationId: string, definitionId: string): Promise<{ valid: boolean; errors: string[] }> {
    const version = await this.getDraftVersion(organizationId, definitionId);
    const graph = await this.graphFromVersion(version);
    return this.validation.validateDraft(graph);
  }

  async publishVersion(input: WorkflowActor & { definitionId: string; changeNote?: string }): Promise<Record<string, unknown>> {
    const result = await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.findFirst({ where: { id: input.definitionId, organizationId: input.organizationId } });
      if (!definition) throw new NotFoundException('WORKFLOW_NOT_FOUND');
      const draft = await tx.workflowVersion.findFirst({ where: { organizationId: input.organizationId, workflowDefinitionId: definition.id, status: 'DRAFT' }, include: { nodes: true, transitions: true } });
      if (!draft) throw new NotFoundException('WORKFLOW_DRAFT_NOT_FOUND');
      const graph = this.graphFromIncluded(draft);
      const result = this.validation.validateDraft(graph);
      if (!result.valid) throw new BadRequestException({ code: 'WORKFLOW_DRAFT_INVALID', errors: result.errors });
      const updated = await tx.workflowVersion.update({ where: { id: draft.id }, data: {
        status: 'PUBLISHED', publishedAt: new Date(), publishedById: input.userId ?? null, changeNote: input.changeNote?.trim() ?? null,
        structureSnapshot: graph as never, updatedById: input.userId ?? null,
      } });
      return updated;
    });
    await this.audit.record({ organizationId: input.organizationId, actorUserId: input.userId, action: 'WORKFLOW_VERSION_PUBLISHED', resourceType: 'WorkflowVersion', resourceId: String(result.id), outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(), metadata: { organizationId: input.organizationId, status: 'PUBLISHED', resourceVersion: result.version } });
    return result;
  }

  async copyPublishedVersion(input: WorkflowActor & { definitionId: string; sourceVersionId?: string; description?: string }): Promise<Record<string, unknown>> {
    const result = await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.findFirst({ where: { id: input.definitionId, organizationId: input.organizationId } });
      if (!definition) throw new NotFoundException('WORKFLOW_NOT_FOUND');
      const source = await tx.workflowVersion.findFirst({ where: { organizationId: input.organizationId, workflowDefinitionId: definition.id, id: input.sourceVersionId, status: 'PUBLISHED' }, include: { nodes: true, transitions: true } });
      const published = source ?? await tx.workflowVersion.findFirst({ where: { organizationId: input.organizationId, workflowDefinitionId: definition.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { nodes: true, transitions: true } });
      if (!published) throw new NotFoundException('WORKFLOW_PUBLISHED_VERSION_NOT_FOUND');
      const next = (await tx.workflowVersion.aggregate({ where: { organizationId: input.organizationId, workflowDefinitionId: definition.id }, _max: { version: true } }))._max.version ?? 0;
      const version = await tx.workflowVersion.create({ data: { organizationId: input.organizationId, workflowDefinitionId: definition.id, version: next + 1, status: 'DRAFT', createdById: input.userId ?? null, updatedById: input.userId ?? null, structureSnapshot: (published.structureSnapshot ?? {}) as never } });
      const nodeMap = new Map<string, string>();
      for (const node of published.nodes) { const id = randomUUID(); nodeMap.set(node.nodeKey, id); await tx.workflowNode.create({ data: { id, organizationId: input.organizationId, workflowVersionId: version.id, nodeKey: node.nodeKey, type: node.type, name: node.name, config: node.config as never, createdById: input.userId ?? null, updatedById: input.userId ?? null } }); }
      for (const transition of published.transitions) await tx.workflowTransition.create({ data: { id: randomUUID(), organizationId: input.organizationId, workflowVersionId: version.id, transitionKey: transition.transitionKey, fromNodeId: nodeMap.get(String(published.nodes.find((node) => node.id === transition.fromNodeId)?.nodeKey))!, toNodeId: nodeMap.get(String(published.nodes.find((node) => node.id === transition.toNodeId)?.nodeKey))!, condition: transition.condition as never, createdById: input.userId ?? null, updatedById: input.userId ?? null } });
      if (input.description !== undefined) await tx.workflowDefinition.update({ where: { id: definition.id }, data: { description: input.description, updatedById: input.userId ?? null } });
      return { ...definition, version: await this.readVersion(tx, version.id) };
    });
    await this.audit.record({ organizationId: input.organizationId, actorUserId: input.userId, action: 'WORKFLOW_VERSION_COPIED', resourceType: 'WorkflowDefinition', resourceId: input.definitionId, outcome: 'SUCCESS', traceId: input.traceId ?? randomUUID(), metadata: { organizationId: input.organizationId, status: 'DRAFT' } });
    return result;
  }

  private async getDraftVersion(organizationId: string, definitionId: string) {
    const version = await this.prisma.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definitionId, status: 'DRAFT' }, include: { nodes: true, transitions: true } });
    if (!version) throw new NotFoundException('WORKFLOW_DRAFT_NOT_FOUND');
    return version;
  }

  private async graphFromVersion(version: { nodes: Array<{ id: string; nodeKey: string; type: string; name: string; config: unknown }>; transitions: Array<{ id: string; transitionKey: string; fromNodeId: string; toNodeId: string; condition: unknown }> }): Promise<WorkflowDraft> { return this.graphFromIncluded(version); }
  private graphFromIncluded(version: { nodes: Array<{ id: string; nodeKey: string; type: string; name: string; config: unknown }>; transitions: Array<{ id: string; transitionKey: string; fromNodeId: string; toNodeId: string; condition: unknown }> }): WorkflowDraft {
    const keys = new Map(version.nodes.map((node) => [node.id, node.nodeKey]));
    return { nodes: version.nodes.map((node) => ({ id: node.nodeKey, type: String(node.type), name: node.name, config: (node.config ?? {}) as Record<string, unknown> })), transitions: version.transitions.map((transition) => ({ id: transition.transitionKey, from: keys.get(transition.fromNodeId) ?? '', to: keys.get(transition.toNodeId) ?? '', condition: (transition.condition ?? {}) as Record<string, unknown> })) };
  }

  private async writeGraph(tx: any, organizationId: string, versionId: string, draft: WorkflowDraft, userId?: string): Promise<void> {
    const nodeIds = new Map<string, string>();
    for (const node of draft.nodes) { const id = randomUUID(); nodeIds.set(node.id, id); await tx.workflowNode.create({ data: { id, organizationId, workflowVersionId: versionId, nodeKey: node.id, type: node.type, name: node.name ?? node.id, config: node.config ?? {}, createdById: userId ?? null, updatedById: userId ?? null } }); }
    for (const transition of draft.transitions) await tx.workflowTransition.create({ data: { id: randomUUID(), organizationId, workflowVersionId: versionId, transitionKey: transition.id, fromNodeId: nodeIds.get(transition.from)!, toNodeId: nodeIds.get(transition.to)!, condition: transition.condition ?? {}, createdById: userId ?? null, updatedById: userId ?? null } });
  }

  private async readVersion(tx: any, id: string): Promise<Record<string, unknown>> { return tx.workflowVersion.findUnique({ where: { id } }); }
}
