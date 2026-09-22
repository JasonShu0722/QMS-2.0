import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma, WorkflowNode } from '../../generated/prisma/client.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import type { WorkflowActionInput, WorkflowCommand, WorkflowParticipantAccess } from '../workflow/workflow-runtime.service.js';
import { assertReplyActor } from './supplier-quality.rules.js';
import { SupplierRuleError } from './supplier-quality.types.js';

@Injectable()
export class SupplierWorkflowAccess implements WorkflowParticipantAccess {
  async lock(tx: Prisma.TransactionClient, input: WorkflowCommand): Promise<void> {
    // Runtime has already locked problem -> instance -> task. Do not lock users here.
    await tx.$queryRaw`SELECT id FROM supplier_quality_problems
      WHERE problem_index_id = ${input.problemIndexId}::uuid AND owner_organization_id = ${input.organizationId}::uuid FOR UPDATE`;
  }

  async authorize(tx: Prisma.TransactionClient, input: WorkflowCommand, selectedNode?: WorkflowNode): Promise<void> {
    const command = input as WorkflowActionInput;
    if (![command.instanceId, command.currentNodeId, command.workflowVersionId].every((id) => typeof id === 'string' && isUUID(id))) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    const problem = await tx.problemIndex.findFirst({ where: { id: input.problemIndexId, organizationId: input.organizationId,
      domainCode: 'supplier-quality', sourceType: 'supplier-quality', archivedAt: null } });
    if (!problem?.sourceId || problem.status === 'ARCHIVED') workflowError('PROBLEM_NOT_FOUND', 404);
    const record = await tx.supplierQualityProblem.findFirst({ where: { id: problem.sourceId, problemIndexId: problem.id, ownerOrganizationId: input.organizationId } });
    if (!record) workflowError('PROBLEM_NOT_FOUND', 404);
    const owner = await tx.organization.findFirst({ where: { id: record.ownerOrganizationId, type: 'INTERNAL', status: 'ACTIVE' } });
    if (!owner) workflowError('ORGANIZATION_DISABLED', 403);
    const instance = await tx.workflowInstance.findFirst({ where: { id: command.instanceId, organizationId: input.organizationId, problemIndexId: problem.id, workflowVersionId: command.workflowVersionId } });
    if (!instance || problem.workflowInstanceId !== instance.id || instance.status === 'CANCELLED') workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    // Authorize the command's original fixed-version node, including replay after the current node moved.
    const node = selectedNode ?? await tx.workflowNode.findFirst({ where: { id: command.currentNodeId, organizationId: input.organizationId, workflowVersionId: instance.workflowVersionId } });
    if (!node || node.id !== command.currentNodeId || node.organizationId !== input.organizationId || node.workflowVersionId !== instance.workflowVersionId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const reply = node.type === 'ACTION' && jsonObject(jsonObject(node.config).assignment).permission === 'supplier-quality:responses:write';
    if (reply) {
      if (command.action !== 'SUBMIT') workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      try {
        assertReplyActor(input.actor, { ...record, replyMode: record.replyMode as 'INTERNAL' | 'SUPPLIER', contentVersion: record.version, releasedToSupplier: record.releasedToSupplierAt !== null }, input.actor.accountType === 'INTERNAL' ? input.organizationId : undefined);
      } catch (error) {
        if (error instanceof SupplierRuleError) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
        throw error;
      }
      await assertWorkflowFeature(tx, input.actor, input.actor.accountType === 'SUPPLIER' ? input.actor.organizationId : input.organizationId, 'supplier-quality:responses:write');
    } else {
      if (input.actor.accountType !== 'INTERNAL') workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      await assertWorkflowFeature(tx, input.actor, input.organizationId, 'supplier-quality:problems:write');
      if (command.action === 'CLOSE' && jsonObject(node.config).requireIndependentVerification !== true) workflowError('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED', 403);
    }
  }
}
