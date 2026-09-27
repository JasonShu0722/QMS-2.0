import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';

@Injectable()
export class SupplierQualityFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-quality';

  constructor(private readonly resources: FileResourceAccess) {}

  onModuleInit(): void {
    this.resources.register(this);
  }

  async authorizeAndLock(transaction: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (!isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const problem = await transaction.supplierQualityProblem.findUnique({ where: { id: resource.resourceId } });
    if (!problem || resource.resourceType !== this.resourceType || !problem.problemIndexId) workflowError('FILE_RESOURCE_DENIED', 403);
    const index = await transaction.problemIndex.findUnique({ where: { id: problem.problemIndexId }, select: { organizationId: true, status: true, archivedAt: true } });
    if (!index || index.organizationId !== problem.ownerOrganizationId || index.archivedAt) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'SUPPLIER' && (problem.replyMode !== 'SUPPLIER' || problem.supplierOrganizationId !== actor.organizationId || !problem.releasedToSupplierAt)) workflowError('FILE_RESOURCE_DENIED', 403);
    if (action !== 'read' && ['RESOLVED', 'CLOSED', 'ARCHIVED'].includes(index.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    const permission = action === 'read'
      ? actor.accountType === 'SUPPLIER' ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read'
      : 'supplier-quality:responses:write';
    await assertWorkflowFeature(transaction, actor, actor.accountType === 'SUPPLIER' ? actor.organizationId : problem.ownerOrganizationId, permission);
    await transaction.$queryRaw`SELECT id FROM supplier_quality_problems WHERE id = ${problem.id}::uuid FOR UPDATE`;
    const current = await transaction.supplierQualityProblem.findUniqueOrThrow({ where: { id: problem.id }, select: { version: true } });
    return { organizationId: problem.supplierOrganizationId, version: current.version };
  }
}
