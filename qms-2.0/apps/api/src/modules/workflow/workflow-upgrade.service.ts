import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { assertWorkflowFeature, canProcessWorkflowNode, type WorkflowActor } from './workflow-access-policy.js';
import { WorkflowUpgradeRegistry, type WorkflowMappingOutcome, type WorkflowUpgradeContext, type WorkflowUpgradePlan, type WorkflowUpgradeRevision } from './workflow-upgrade.registry.js';
import { WorkflowUpgradePreviewDto, WorkflowUpgradeRequestDto, WorkflowUpgradeResultDto } from './workflow-upgrade.dto.js';
import { canonical, jsonObject, workflowError } from './workflow-runtime-policy.js';
import { createWorkflowStart, fixedWorkflowStart } from './workflow-start.js';

@Injectable()
export class WorkflowUpgradeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly outbox: OutboxService,
    private readonly problems: ProblemIndexService, private readonly registry: WorkflowUpgradeRegistry) {}

  async preview(actor: WorkflowActor, problemId: string, organizationId = actor.organizationId): Promise<WorkflowUpgradePreviewDto> {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.lock(tx, actor, organizationId, problemId);
      const adapter = this.registry.forProblem(context.problem);
      await adapter.authorizeAndLock(tx, actor, context.problem, 'preview');
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
      await adapter.authorizeAndLock(tx, actor, context.problem, 'preview');
      const result: WorkflowUpgradePreviewDto = { problemId, reportNumber: context.problem.reportNumber, canUpgrade: false, reasonCode: null,
        instanceId: context.instance.id, currentNodeId: context.node.id, expectedProblemVersion: context.problem.version,
        expectedInstanceVersion: context.instance.version, expectedDomainVersion: null, targetVersionId: null, targetProblemType: null, mappingVersion: null, mappingSummary: [] };
      try {
        await this.assertEligible(tx, context);
        const plan = await adapter.prepare(tx, context);
        this.assertPlan(plan, context);
        await fixedWorkflowStart(tx, organizationId, plan.targetDefinitionId, plan.targetVersionId);
        return { ...result, canUpgrade: true, expectedDomainVersion: plan.domainVersion, targetVersionId: plan.targetVersionId,
          targetProblemType: plan.targetProblemType, mappingVersion: plan.mappingVersion, mappingSummary: plan.mappingSummary };
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const code = (error.getResponse() as { code?: string }).code;
        if (!['WORKFLOW_UPGRADE_NOT_ALLOWED', 'WORKFLOW_NODE_FORBIDDEN', 'TASK_CLAIM_OWNER_REQUIRED', 'FEATURE_PERMISSION_DENIED'].includes(code ?? '')) throw error;
        return { ...result, reasonCode: code! };
      }
    }, { isolationLevel: 'ReadCommitted' });
  }

  async upgrade(actor: WorkflowActor, problemId: string, input: WorkflowUpgradeRequestDto, key: string, traceId: string): Promise<WorkflowUpgradeResultDto> {
    this.assertInput(problemId, input, key);
    const organizationId = input.organizationId ?? actor.organizationId;
    const { organizationId: _organization, ...request } = input;
    const digest = createHash('sha256').update(canonical({ organizationId, problemId, actorUserId: actor.id, ...request, reason: input.reason.trim() })).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const lock = `workflow-upgrade:${organizationId}:${actor.id}:${key}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
      const receipt = await tx.workflowUpgrade.findUnique({ where: { organizationId_actorUserId_key: { organizationId, actorUserId: actor.id, key } } });
      const context = await this.lock(tx, actor, organizationId, problemId, input.instanceId);
      const adapter = this.registry.forProblem(context.problem);
      await adapter.authorizeAndLock(tx, actor, context.problem, receipt ? 'history' : 'upgrade');
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'workflow:act');
      await adapter.authorizeAndLock(tx, actor, context.problem, receipt ? 'history' : 'upgrade');
      if (!await canProcessWorkflowNode(tx, actor.id, organizationId, jsonObject(context.node.config).assignment)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      if (receipt) {
        if (receipt.requestDigest !== digest || receipt.problemIndexId !== problemId) workflowError('IDEMPOTENCY_REPLAY', 409);
        return receipt.response as unknown as WorkflowUpgradeResultDto;
      }
      if (context.problem.version !== input.expectedProblemVersion || context.instance.version !== input.expectedInstanceVersion
        || context.node.id !== input.currentNodeId || context.problem.workflowInstanceId !== context.instance.id) workflowError('CONCURRENCY_CONFLICT', 409);
      await this.assertEligible(tx, context);
      const plan = await adapter.prepare(tx, context);
      this.assertPlan(plan, context);
      if (plan.domainVersion !== input.expectedDomainVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      await fixedWorkflowStart(tx, organizationId, plan.targetDefinitionId, plan.targetVersionId);
      const id = randomUUID();
      let revision!: WorkflowUpgradeRevision;
      const started = await createWorkflowStart(tx, { organizationId, actor, problemIndexId: problemId, workflowDefinitionId: plan.targetDefinitionId,
        workflowVersionId: plan.targetVersionId, expectedProblemVersion: input.expectedProblemVersion, instanceKey: `upgrade:${id}`,
        idempotencyKey: `upgrade-start:${id}`, traceId }, digest, { audit: this.audit, outbox: this.outbox, problems: this.problems }, context.instance.id,
      async (instanceId, node) => {
        revision = await adapter.apply(tx, context, plan, { instanceId, nodeId: node.id, expectedDomainVersion: input.expectedDomainVersion });
        this.assertRevision(revision, plan);
        const unchanged = await tx.problemIndex.findUniqueOrThrow({ where: { id: problemId } });
        if (['organizationId', 'reportNumber', 'domainCode', 'sourceType', 'sourceId'].some((field) => unchanged[field as keyof typeof unchanged] !== context.problem[field as keyof typeof context.problem])) workflowError('WORKFLOW_UPGRADE_MAPPING_INVALID', 409);
        const cancelled = await tx.workflowInstance.updateMany({ where: { id: context.instance.id, problemIndexId: problemId, version: input.expectedInstanceVersion, status: 'RUNNING' },
          data: { status: 'CANCELLED', version: { increment: 1 }, updatedById: actor.id } });
        if (cancelled.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
        await tx.workflowTask.updateMany({ where: { workflowInstanceId: context.instance.id, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } },
          data: { status: 'CANCELLED', version: { increment: 1 }, updatedById: actor.id } });
      }, plan.targetProblemType);
      const upgradedAt = new Date();
      const result: WorkflowUpgradeResultDto = { id, problemId, reportNumber: context.problem.reportNumber, beforeInstanceId: context.instance.id,
        afterInstanceId: started.instanceId, workflowVersionId: started.workflowVersionId, currentNodeId: started.currentNodeId, problemVersion: started.problemVersion,
        instanceVersion: started.version, domainVersion: revision.domainVersion, beforeDomainRevisionId: revision.beforeDomainRevisionId,
        afterDomainRevisionId: revision.afterDomainRevisionId, mappingVersion: plan.mappingVersion, mappingSummary: revision.mappingSummary, upgradedAt: upgradedAt.toISOString() };
      await tx.workflowUpgrade.create({ data: { id, organizationId, problemIndexId: problemId, actorUserId: actor.id, beforeInstanceId: context.instance.id,
        afterInstanceId: started.instanceId, beforeProblemVersion: input.expectedProblemVersion, afterProblemVersion: started.problemVersion,
        beforeDomainRevisionId: revision.beforeDomainRevisionId, afterDomainRevisionId: revision.afterDomainRevisionId, mappingVersion: plan.mappingVersion,
        mappingSummary: revision.mappingSummary as unknown as Prisma.InputJsonValue, reason: input.reason.trim(), key, requestDigest: digest,
        response: result as unknown as Prisma.InputJsonValue, createdAt: upgradedAt } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'WORKFLOW_UPGRADED', resourceType: 'WorkflowUpgrade', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { resourceVersion: started.problemVersion, reasonCode: 'BRIEF_TO_8D' } }, tx);
      return result;
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async lock(tx: Prisma.TransactionClient, actor: WorkflowActor, organizationId: string, problemId: string, requestedInstanceId?: string): Promise<WorkflowUpgradeContext> {
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${problemId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    const problem = await tx.problemIndex.findFirst({ where: { id: problemId, organizationId } });
    if (!problem) workflowError('PROBLEM_NOT_FOUND', 404);
    const instanceId = requestedInstanceId ?? problem.workflowInstanceId;
    if (!instanceId) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${instanceId}::uuid AND organization_id = ${organizationId}::uuid AND problem_index_id = ${problemId}::uuid FOR UPDATE`;
    const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId, organizationId, problemIndexId: problemId }, include: { currentNode: true } });
    if (!instance?.currentNode) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE workflow_instance_id = ${instance.id}::uuid AND status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') ORDER BY id FOR UPDATE`;
    return { actor, problem, instance, node: instance.currentNode };
  }

  private async assertEligible(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext) {
    if (context.problem.archivedAt || ['ARCHIVED', 'CLOSED'].includes(context.problem.status) || context.instance.status !== 'RUNNING'
      || context.problem.workflowInstanceId !== context.instance.id) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    await assertWorkflowFeature(tx, context.actor, context.problem.organizationId, 'workflow:act');
    if (!await canProcessWorkflowNode(tx, context.actor.id, context.problem.organizationId, jsonObject(context.node.config).assignment)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const task = await tx.workflowTask.findFirst({ where: { workflowInstanceId: context.instance.id, organizationId: context.problem.organizationId,
      workflowVersionId: context.instance.workflowVersionId, workflowNodeId: context.node.id, entryInstanceVersion: context.instance.version,
      status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } } });
    if (task?.claimedByUserId && task.claimedByUserId !== context.actor.id) workflowError('TASK_CLAIM_OWNER_REQUIRED', 403);
  }

  private assertInput(problemId: string, input: WorkflowUpgradeRequestDto, key: string) {
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key ?? '')) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (![problemId, input.instanceId, input.currentNodeId].every((id) => isUUID(id)) || (input.organizationId !== undefined && !isUUID(input.organizationId))
      || ![input.expectedProblemVersion, input.expectedInstanceVersion, input.expectedDomainVersion].every((version) => Number.isInteger(version) && version > 0 && version <= 2147483647)
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw new BadRequestException();
  }

  private assertPlan(plan: WorkflowUpgradePlan, context: WorkflowUpgradeContext) {
    if (!Number.isSafeInteger(plan.domainVersion) || plan.domainVersion < 1 || ![plan.targetDefinitionId, plan.targetVersionId, plan.beforeDomainRevisionId].every((id) => isUUID(id))
      || !/^[A-Za-z0-9._:-]{1,100}$/.test(plan.mappingVersion) || !plan.targetProblemType?.trim() || plan.targetProblemType.length > 100
      || plan.targetProblemType === context.problem.problemType) workflowError('WORKFLOW_UPGRADE_MAPPING_INVALID', 409);
    if (!Array.isArray(plan.allowedNodeIds) || !plan.allowedNodeIds.includes(context.node.id)) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    this.assertSummary(plan.mappingSummary);
    this.assertEvidence(plan.evidenceFileIds);
  }

  private assertRevision(revision: WorkflowUpgradeRevision, plan: WorkflowUpgradePlan) {
    this.assertSummary(revision.mappingSummary);
    this.assertEvidence(revision.evidenceFileIds);
    if (revision.domainVersion !== plan.domainVersion + 1 || revision.beforeDomainRevisionId !== plan.beforeDomainRevisionId || !isUUID(revision.afterDomainRevisionId)
      || revision.beforeDomainRevisionId === revision.afterDomainRevisionId || canonical(revision.mappingSummary) !== canonical(plan.mappingSummary)
      || canonical([...revision.evidenceFileIds].sort()) !== canonical([...plan.evidenceFileIds].sort())) workflowError('WORKFLOW_UPGRADE_MAPPING_INVALID', 409);
  }

  private assertSummary(summary: WorkflowMappingOutcome[]) {
    if (!Array.isArray(summary) || summary.length > 200 || new Set(summary.map((item) => item?.fieldId)).size !== summary.length
      || summary.some((item) => !item || Object.keys(item).some((key) => !['fieldId', 'outcome'].includes(key)) || !/^[A-Za-z][A-Za-z0-9._:-]{0,99}$/.test(item.fieldId)
        || !['COPIED', 'PRESERVED', 'UNMAPPED'].includes(item.outcome))) workflowError('WORKFLOW_UPGRADE_MAPPING_INVALID', 409);
  }

  private assertEvidence(ids: readonly string[]) {
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => !isUUID(id))) workflowError('WORKFLOW_UPGRADE_MAPPING_INVALID', 409);
  }
}
