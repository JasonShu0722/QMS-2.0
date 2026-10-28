import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { WorkflowClosureRegistry } from '../workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext, WorkflowClosureOperation } from '../workflow/workflow-closure-round.types.js';
import type { WorkflowDeadlineOperation, WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import type { WorkflowAdministrativeInvalidationInput } from '../workflow/workflow-administrative-invalidation.types.js';

@Injectable()
export class ProcessEightDClosureAdapter implements WorkflowClosureAdapter, OnModuleInit {
  readonly domainCode = 'process-quality';
  constructor(private readonly registry: WorkflowClosureRegistry, private readonly service: ProcessEightDService) {}
  onModuleInit(): void { this.registry.register(this); }
  lockAndRead(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, operation: WorkflowClosureOperation) {
    return this.service.closureContext(tx, actor, problemId, operation);
  }
  complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor?: WorkflowActor) { return this.service.complete(tx, context, actor); }
  returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor?: WorkflowActor) { return this.service.returnForChanges(tx, context, actor); }
  canNotifyRecipient(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string) { return this.service.canNotifyClosureRecipient(tx, context, userId); }
  administrativeInvalidation(tx: Prisma.TransactionClient, input: WorkflowAdministrativeInvalidationInput) { return this.service.administrativeInvalidation(tx, input); }

  async deadlineContext(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor, operation: WorkflowDeadlineOperation) {
    const record = await this.service.lockRecord(tx, actor, context.problemId, operation === 'READ' || operation === 'ELIGIBILITY' ? 'READ' : 'DEADLINE');
    await this.service.authorizeRead(tx, actor, record);
    if (record.problem.organizationId !== context.organizationId || record.instance.id !== context.instanceId || record.instance.workflowVersionId !== context.workflowVersionId) workflowError('CONCURRENCY_CONFLICT', 409);
    if (operation === 'REQUEST') {
      await this.service.authorizeDeadlineRequest(tx, actor, record);
    }
    if (operation === 'DECIDE' || operation === 'ELIGIBILITY') await assertWorkflowFeature(tx, actor, context.organizationId, 'workflow:act');
    return this.service.deadlineContext(tx, record);
  }

  async applyDeadlineExtension(tx: Prisma.TransactionClient, context: WorkflowClosureContext, stage: WorkflowDeadlineStage, dueAt: Date) {
    const deadline = await this.service.notificationContext(tx, context.organizationId, context.problemId);
    if (!deadline || deadline.instanceId !== context.instanceId || deadline.workflowVersionId !== context.workflowVersionId
      || deadline.ownerUserId !== context.ownerUserId || deadline.professionalUserId !== context.professionalUserId
      || deadline.responsibleSectionDepartmentId !== context.responsibleSectionDepartmentId) workflowError('CONCURRENCY_CONFLICT', 409);
    // This is a trusted engine hook in its existing transaction, not an impersonated user command.
    await this.service.applyApprovedDeadlineExtension(tx, deadline, stage, dueAt);
  }
}
