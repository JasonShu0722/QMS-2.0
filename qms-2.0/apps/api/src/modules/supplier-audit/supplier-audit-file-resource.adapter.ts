import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierAuditFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-audit-record';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const [record] = await tx.$queryRaw<{ owner_organization_id: string; status: string; version: number }[]>`
      SELECT owner_organization_id, status, version FROM supplier_audit_records WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    if (!record || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, record.owner_organization_id, action === 'read' ? 'supplier-audit:records:read' : 'supplier-audit:records:write');
    if (action !== 'read' && record.status !== 'DRAFT') workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.owner_organization_id, version: record.version };
  }
}
