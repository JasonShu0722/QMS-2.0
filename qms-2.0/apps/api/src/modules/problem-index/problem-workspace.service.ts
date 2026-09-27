import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma, type WorkflowInstance } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { canProcessWorkflowNode, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowCapabilities } from '../workflow/workflow-capabilities.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import type { TaskDto } from '../task-notification/task-inbox.dto.js';
import { ProblemQueryService, problemDto } from './problem-query.service.js';
import { domainKey, domainText, workspaceProjection } from './problem-domain-projection.js';
import type { ProblemDomainReadAdapter, ProblemDomainReadContext } from './problem-domain-registry.js';
import { ProblemWorkspaceDto, type ProblemInstanceDto, type ProblemWorkspaceQueryDto } from './problem-workspace.dto.js';

export function instanceProjection(instance: WorkflowInstance, currentId: string | null): ProblemInstanceDto {
  return { id: instance.id, workflowVersionId: instance.workflowVersionId, currentNodeId: instance.currentNodeId, status: instance.status,
    version: instance.version, current: instance.id === currentId, createdAt: instance.createdAt.toISOString() };
}

@Injectable()
export class ProblemWorkspaceService {
  constructor(private readonly prisma: PrismaService, private readonly problems: ProblemQueryService, private readonly files: FileLifecycleService) {}

  async selectInstance(tx: Prisma.TransactionClient, organizationId: string, problemId: string, instanceId: string | null) {
    if (!instanceId) return null;
    if (!isUUID(instanceId)) throw new BadRequestException();
    const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId, organizationId, problemIndexId: problemId } });
    if (!instance) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    return instance;
  }

  async history(tx: Prisma.TransactionClient, organizationId: string, problemId: string, currentId: string | null) {
    const instances = await tx.workflowInstance.findMany({ where: { organizationId, problemIndexId: problemId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const upgrades = await tx.workflowUpgrade.findMany({ where: { organizationId, problemIndexId: problemId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { instances: instances.map((instance) => instanceProjection(instance, currentId)), upgrades: upgrades.map((upgrade) => ({ id: upgrade.id,
      beforeInstanceId: upgrade.beforeInstanceId, afterInstanceId: upgrade.afterInstanceId, actorUserId: upgrade.actorUserId, reason: upgrade.reason,
      createdAt: upgrade.createdAt.toISOString(), beforeDomainRevisionId: upgrade.beforeDomainRevisionId, afterDomainRevisionId: upgrade.afterDomainRevisionId, mappingVersion: upgrade.mappingVersion })) };
  }

  async nodeFacts(tx: Prisma.TransactionClient, instance: WorkflowInstance | null, maximumVersion?: number) {
    if (!instance) return { nodes: [], workflowActions: [] };
    const nodes = await tx.workflowNode.findMany({ where: { organizationId: instance.organizationId, workflowVersionId: instance.workflowVersionId }, orderBy: [{ nodeKey: 'asc' }, { id: 'asc' }] });
    const mutations = await tx.workflowMutation.findMany({ where: { organizationId: instance.organizationId, instanceId: instance.id, workflowVersionId: instance.workflowVersionId, ...(maximumVersion ? { instanceVersion: { lte: maximumVersion } } : {}) }, orderBy: [{ instanceVersion: 'asc' }, { id: 'asc' }] });
    return { nodes: nodes.map((node) => ({ id: node.id, key: node.nodeKey, name: node.name, type: node.type, current: instance.currentNodeId === node.id,
      visited: mutations.some((mutation) => mutation.nodeId === node.id || jsonObject(mutation.response).currentNodeId === node.id),
      actionCount: mutations.filter((mutation) => mutation.nodeId === node.id && mutation.action !== 'START').length })),
      workflowActions: mutations.map((mutation) => ({ id: mutation.id, nodeId: mutation.nodeId, action: mutation.action, instanceVersion: mutation.instanceVersion,
        actorUserId: mutation.actorUserId, createdAt: mutation.createdAt.toISOString() })) };
  }

  async evidence(tx: Prisma.TransactionClient, adapter: ProblemDomainReadAdapter, context: ProblemDomainReadContext, revisionId: string | null) {
    const references = await adapter.listEvidenceReferences(tx, context, revisionId);
    if (references.length > 100 || new Set(references.map((reference) => reference.fileId)).size !== references.length) throw new Error('PROBLEM_EVIDENCE_INVALID');
    const groups = new Map<string, { resource: { resourceType: string; resourceId: string }; fileIds: string[] }>();
    for (const reference of references) {
      if (!isUUID(reference.fileId) || !isUUID(reference.resourceId)) throw new Error('PROBLEM_EVIDENCE_INVALID');
      const key = `${domainKey(reference.resourceType)}:${reference.resourceId}`;
      const group = groups.get(key) ?? { resource: { resourceType: reference.resourceType, resourceId: reference.resourceId }, fileIds: [] };
      group.fileIds.push(reference.fileId);
      groups.set(key, group);
    }
    return this.files.readEvidence(tx, context.actor, [...groups.values()]);
  }

  async read(actor: WorkflowActor, organizationId: string, id: string, query: ProblemWorkspaceQueryDto): Promise<ProblemWorkspaceDto> {
    return this.prisma.$transaction(async (tx) => {
      const { problem, adapter, context } = await this.problems.authorized(tx, actor, organizationId, id, 'overview');
      const selected = await this.selectInstance(tx, organizationId, id, query.instanceId ?? problem.workflowInstanceId);
      const historical = !!selected && selected.id !== problem.workflowInstanceId;
      if (historical) await adapter.authorizeRead(tx, { ...context, purpose: 'history' });
      const summary = (await adapter.readSummaries(tx, actor, [problem])).get(problem.id);
      if (!summary) throw new Error('PROBLEM_SUMMARY_UNAVAILABLE');
      const content = await adapter.readWorkspace(tx, { ...context, purpose: historical ? 'history' : 'overview' }, selected);
      const domain = content ? workspaceProjection(content) : null;
      const history = await this.history(tx, organizationId, id, problem.workflowInstanceId);
      const facts = await this.nodeFacts(tx, selected);
      const capabilities = selected ? await workflowCapabilities(tx, actor, problem, selected) : { canAct: false, allowedActions: [], reasonCode: 'WORKFLOW_INSTANCE_NOT_FOUND', currentNodeId: null, taskId: null, claimedByUserId: null, projectionPending: false };
      const task = await this.currentTask(tx, actor, problem.reportNumber, id, capabilities.taskId);
      const actions = historical ? [] : (await adapter.describeActions(tx, context)).map((action) => ({ actionKey: domainKey(action.actionKey), label: domainText(action.label, 200), enabled: action.enabled === true && capabilities.canAct, reasonCode: action.enabled && capabilities.canAct ? null : action.reasonCode ?? capabilities.reasonCode }));
      const evidence = domain ? await this.evidence(tx, adapter, { ...context, purpose: historical ? 'history' : 'overview' }, domain.revisionId) : [];
      await this.problems.authenticate(tx, actor, organizationId);
      return { problem: problemDto(problem, summary), selectedInstance: selected ? instanceProjection(selected, problem.workflowInstanceId) : null,
        ...history, ...facts, domain, domainAvailability: domain ? 'AVAILABLE' : 'UNAVAILABLE', readOnly: historical || !capabilities.canAct,
        capabilities, task, actions, evidence };
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async currentTask(tx: Prisma.TransactionClient, actor: WorkflowActor, reportNumber: string, problemId: string, taskId: string | null): Promise<TaskDto | null> {
    if (!taskId) return null;
    const task = await tx.workflowTask.findUnique({ where: { id: taskId }, include: { workflowNode: true } });
    if (!task) return null;
    const [access] = await tx.$queryRaw<{ read: boolean; claim: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${task.organizationId}::uuid`, Prisma.sql`'task:read'`)} AS read, ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${task.organizationId}::uuid`, Prisma.sql`'task:claim'`)} AS claim`);
    if (!access?.read) return null;
    const ownerEligible = !!task.claimedByUserId && await canProcessWorkflowNode(tx, task.claimedByUserId, task.organizationId, jsonObject(task.workflowNode.config).assignment);
    return { id: task.id, version: task.version, instanceId: task.workflowInstanceId, fixedVersion: task.workflowVersionId, entryInstanceVersion: task.entryInstanceVersion,
      nodeId: task.workflowNodeId, name: task.workflowNode.name, type: task.workflowNode.type, problemId, reportNumber, dueAt: task.dueAt?.toISOString() ?? null,
      status: task.status, claimedByUserId: task.claimedByUserId, claimedAt: task.claimedAt?.toISOString() ?? null,
      canAct: !task.claimedByUserId || task.claimedByUserId === actor.id,
      canClaim: access.claim && (!task.claimedByUserId || task.claimedByUserId !== actor.id && !ownerEligible), canRelease: access.claim && task.claimedByUserId === actor.id,
      canRetry: access.claim && task.status === 'FAILED' };
  }
}
