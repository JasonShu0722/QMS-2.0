import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class ProcessShipmentReportFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'process-shipment-report';

  constructor(private readonly resources: FileResourceAccess) {}

  onModuleInit(): void { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const rows = await tx.$queryRaw<Array<{ id: string; organization_id: string; archived_at: Date | null; version: number }>>`SELECT id, organization_id, archived_at, version FROM process_shipment_reports WHERE id = ${resource.resourceId}::uuid FOR UPDATE`;
    const record = rows[0];
    if (!record || actor.accountType !== 'INTERNAL' || actor.organizationId !== record.organization_id) workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, record.organization_id, action === 'read' ? 'process-quality:defects:read' : 'process-quality:defects:write');
    if (action !== 'read' && record.archived_at) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.organization_id, version: Number(record.version) };
  }
}
