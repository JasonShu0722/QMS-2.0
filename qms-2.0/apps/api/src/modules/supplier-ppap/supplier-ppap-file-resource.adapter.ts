import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierPpapFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-ppap-item';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const [pack] = await tx.$queryRaw<{ owner_organization_id: string; status: string; version: number }[]>`
      SELECT pack.owner_organization_id, pack.status, item.version FROM supplier_ppap_items item
      JOIN supplier_ppap_packages pack ON pack.id = item.package_id AND pack.owner_organization_id = item.owner_organization_id
      WHERE item.id = ${resource.resourceId}::uuid FOR UPDATE OF pack, item`;
    if (!pack || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, pack.owner_organization_id, action === 'read' ? 'supplier-ppap:read' : 'supplier-ppap:write');
    if (action !== 'read' && !['DRAFT', 'REJECTED'].includes(pack.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: pack.owner_organization_id, version: pack.version };
  }
}
