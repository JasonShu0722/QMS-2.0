import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export interface StartWorkflowInstanceInput { organizationId: string; problemIndexId: string; workflowDefinitionId: string; workflowVersionId: string; actorUserId: string; instanceKey: string; idempotencyKey: string; }
export interface WorkflowActionInput { organizationId: string; instanceId: string; actorUserId: string; expectedVersion: number; action: string; idempotencyKey: string; }

@Injectable()
export class WorkflowRuntimeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: unknown, private readonly outbox: unknown, private readonly problems: unknown) {}

  async startInstance(input: StartWorkflowInstanceInput): Promise<Record<string, unknown>> {
    const client = this.prisma as any;
    return client.$transaction(async (tx: any) => {
      const version = await tx.workflowVersion.findFirst({ where: { id: input.workflowVersionId, organizationId: input.organizationId, workflowDefinitionId: input.workflowDefinitionId, status: 'PUBLISHED' }, include: { nodes: true } });
      if (!version) throw new NotFoundException('WORKFLOW_VERSION_NOT_FOUND');
      const existing = await tx.workflowInstance.findFirst({ where: { organizationId: input.organizationId, instanceKey: input.instanceKey } });
      if (existing) {
        if (existing.idempotencyKey && existing.idempotencyKey !== input.idempotencyKey) throw new ConflictException('IDEMPOTENCY_REPLAY');
        return existing;
      }
      const start = version.nodes.find((node: any) => node.config?.isStart) ?? version.nodes[0];
      if (!start) throw new ConflictException('WORKFLOW_START_NODE_MISSING');
      return tx.workflowInstance.create({ data: { organizationId: input.organizationId, workflowDefinitionId: input.workflowDefinitionId, workflowVersionId: input.workflowVersionId, instanceKey: input.instanceKey, currentNodeId: start.id, status: 'RUNNING', version: 1, createdById: input.actorUserId, updatedById: input.actorUserId } });
    });
  }

  async submitAction(input: WorkflowActionInput): Promise<Record<string, unknown>> {
    const client = this.prisma as any;
    return client.$transaction(async (tx: any) => {
      const instance = await tx.workflowInstance.findFirst({ where: { id: input.instanceId, organizationId: input.organizationId } });
      if (!instance) throw new NotFoundException('WORKFLOW_INSTANCE_NOT_FOUND');
      if (instance.version !== input.expectedVersion) throw new ConflictException('CONCURRENCY_CONFLICT');
      const updated = await tx.workflowInstance.updateMany({ where: { id: input.instanceId, organizationId: input.organizationId, version: input.expectedVersion }, data: { version: { increment: 1 }, updatedById: input.actorUserId } });
      if (updated.count !== 1) throw new ConflictException('CONCURRENCY_CONFLICT');
      return tx.workflowInstance.findFirst({ where: { id: input.instanceId, organizationId: input.organizationId } });
    });
  }

  approve(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'APPROVE' }); }
  verify(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'VERIFY' }); }
  reject(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'REJECT' }); }
  returnToPrevious(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'RETURN' }); }
  reopen(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'REOPEN' }); }
  close(input: WorkflowActionInput) { return this.submitAction({ ...input, action: 'CLOSE' }); }
}
