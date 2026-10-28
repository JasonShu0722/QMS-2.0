import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { WorkflowClosureRegistry } from '../workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext, WorkflowClosureOperation, WorkflowSupplierSubmissionInput } from '../workflow/workflow-closure-round.types.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import type { AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import type { WorkflowAdministrativeInvalidationInput } from '../workflow/workflow-administrative-invalidation.types.js';

@Injectable()
export class SupplierEightDClosureAdapter implements WorkflowClosureAdapter, OnModuleInit {
  readonly domainCode = 'supplier-quality';
  constructor(private readonly registry: WorkflowClosureRegistry, private readonly service: SupplierEightDService) {}
  onModuleInit() { this.registry.register(this); }
  lockAndRead(tx: Prisma.TransactionClient, actor: WorkflowActor, indexId: string, operation: WorkflowClosureOperation) { return this.service.closureContext(tx, actor, indexId, operation); }
  lockSupplierSubmission(tx: Prisma.TransactionClient, actor: WorkflowActor, indexId: string, input: WorkflowSupplierSubmissionInput) { return this.service.supplierSubmissionContext(tx, actor, indexId, input); }
  complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor) { return this.service.complete(tx, context, actor); }
  returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor) { return this.service.returnForChanges(tx, context, actor); }
  canNotifyRecipient(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string) { return this.service.canNotifyClosureRecipient(tx, context, userId); }
  administrativeInvalidation(tx: Prisma.TransactionClient, input: WorkflowAdministrativeInvalidationInput) { return this.service.administrativeInvalidation(tx, input); }
  administrativeInvalidationTargets(tx: Prisma.TransactionClient, impact: AdministrativeLifecycleImpact) { return this.service.administrativeInvalidationTargets(tx, impact); }
}
