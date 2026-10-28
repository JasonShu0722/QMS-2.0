import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';

@Injectable()
export class SupplierQualityFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-quality';

  constructor(private readonly resources: FileResourceAccess, @Optional() private readonly eightD?: SupplierEightDService) {}

  onModuleInit(): void {
    this.resources.register(this);
  }

  async authorizeAndLock(transaction: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const [controlled] = await transaction.$queryRaw<{ id: string }[]>`SELECT supplier_problem_id AS id
      FROM supplier_eight_d_controls WHERE supplier_problem_id = ${resource.resourceId}::uuid`;
    if (controlled) {
      if (!this.eightD || resource.resourceType !== this.resourceType) workflowError('FILE_RESOURCE_DENIED', 403);
      return this.eightD.fileGrant(transaction, actor, resource.resourceId, action, 'response');
    }
    await transaction.$queryRaw`SELECT id FROM supplier_quality_problems WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const problem = await transaction.supplierQualityProblem.findUnique({ where: { id: resource.resourceId } });
    if (!problem || resource.resourceType !== this.resourceType || !problem.problemIndexId) workflowError('FILE_RESOURCE_DENIED', 403);
    const index = await transaction.problemIndex.findUnique({ where: { id: problem.problemIndexId }, select: { organizationId: true, status: true, archivedAt: true } });
    if (!index || index.organizationId !== problem.ownerOrganizationId || index.archivedAt) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'SUPPLIER' && (!problem.supplierOrganizationId || problem.replyMode !== 'SUPPLIER' || problem.supplierOrganizationId !== actor.organizationId || !problem.releasedToSupplierAt)) workflowError('FILE_RESOURCE_DENIED', 403);
    if (action !== 'read' && ['RESOLVED', 'CLOSED', 'ARCHIVED'].includes(index.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    const permission = action === 'read'
      ? actor.accountType === 'SUPPLIER' ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read'
      : 'supplier-quality:responses:write';
    await assertWorkflowFeature(transaction, actor, actor.accountType === 'SUPPLIER' ? actor.organizationId : problem.ownerOrganizationId, permission);
    return { organizationId: problem.supplierOrganizationId ?? problem.ownerOrganizationId, version: problem.version };
  }
}
