import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierAdmissionFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-admission';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const rows = await tx.$queryRaw<{ id: string; owner_organization_id: string; supplier_organization_id: string; status: string; version: number }[]>`
      SELECT id, owner_organization_id, supplier_organization_id, status, version
      FROM supplier_admission_documents WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'SUPPLIER' && actor.organizationId !== row.supplier_organization_id) workflowError('FILE_RESOURCE_DENIED', 403);
    if (actor.accountType === 'INTERNAL' && actor.organizationId !== row.owner_organization_id) workflowError('FILE_RESOURCE_DENIED', 403);
    if (action === 'delete' || (action !== 'read' && (actor.accountType !== 'SUPPLIER' || !['DRAFT', 'NEEDS_CHANGES'].includes(row.status)))) workflowError('FILE_RESOURCE_DENIED', 403);
    const permission = actor.accountType === 'SUPPLIER'
      ? action === 'read' ? 'supplier-admission:submissions:read' : 'supplier-admission:submissions:write'
      : 'supplier-admission:documents:read';
    await assertWorkflowFeature(tx, actor, actor.accountType === 'SUPPLIER' ? row.supplier_organization_id : row.owner_organization_id, permission);
    return { organizationId: row.supplier_organization_id, version: row.version };
  }
}
