import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierPcnFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-pcn';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const [row] = await tx.$queryRaw<{ owner_organization_id: string; supplier_organization_id: string; status: string; version: number }[]>`
      SELECT owner_organization_id, supplier_organization_id, status, version FROM supplier_pcns WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    if (!row) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'SUPPLIER' && actor.organizationId !== row.supplier_organization_id) workflowError('FILE_RESOURCE_DENIED', 403);
    if (action === 'delete' || (action !== 'read' && (actor.accountType !== 'SUPPLIER' || !['DRAFT', 'NEEDS_CHANGES'].includes(row.status)))) workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, actor.accountType === 'SUPPLIER' ? row.supplier_organization_id : row.owner_organization_id,
      actor.accountType === 'SUPPLIER' ? action === 'read' ? 'supplier-pcn:submissions:read' : 'supplier-pcn:submissions:write' : 'supplier-pcn:requests:read');
    return { organizationId: row.supplier_organization_id, version: row.version };
  }
}
