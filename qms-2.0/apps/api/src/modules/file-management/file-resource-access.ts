import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

export type FileActor = WorkflowActor;
export interface FileResourceRef { resourceType: string; resourceId: string }
export type FileResourceAction = 'upload' | 'complete' | 'read' | 'delete' | 'attach';
export interface FileResourceGrant { organizationId: string; version: number }
export interface FileResourceAccessAdapter {
  readonly resourceType: string;
  authorizeAndLock(transaction: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant>;
}
export const FILE_RESOURCE_ADAPTERS = Symbol('FILE_RESOURCE_ADAPTERS');

@Injectable()
export class FileResourceAccess {
  constructor(@Inject(FILE_RESOURCE_ADAPTERS) private readonly adapters: readonly FileResourceAccessAdapter[]) {
    if (new Set(adapters.map((adapter) => adapter.resourceType)).size !== adapters.length) throw new Error('FILE_RESOURCE_ADAPTER_DUPLICATE');
  }

  async authorizeAndLock(transaction: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    const adapter = this.adapters.find((candidate) => candidate.resourceType === resource.resourceType);
    if (!adapter) workflowError('FILE_RESOURCE_DENIED', 403);
    const grant = await adapter.authorizeAndLock(transaction, actor, resource, action);
    if (!grant || !Number.isSafeInteger(grant.version) || grant.version < 1) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'SUPPLIER' && actor.organizationId !== grant.organizationId) workflowError('FILE_RESOURCE_DENIED', 403);
    const organization = await transaction.organization.findUnique({ where: { id: grant.organizationId } });
    if (organization?.status !== 'ACTIVE') workflowError('FILE_RESOURCE_DENIED', 403);
    return grant;
  }
}
