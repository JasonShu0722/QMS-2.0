import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierIncomingFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-incoming';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }
  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const rows = await tx.$queryRaw<{ id: string; owner_organization_id: string; version: number; status: string }[]>`SELECT id, owner_organization_id, version, status FROM supplier_incoming_inspections WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const record = rows[0];
    if (!record || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, record.owner_organization_id, action === 'read' ? 'supplier-incoming:inspections:read' : 'supplier-incoming:inspections:write');
    if (action !== 'read' && record.status === 'CORRECTED') workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.owner_organization_id, version: record.version };
  }
}
