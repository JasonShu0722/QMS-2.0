import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class CustomerComplaintFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'CustomerComplaint';

  constructor(private readonly resources: FileResourceAccess) {}

  onModuleInit(): void { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId) || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    const complaint = await tx.customerQualityComplaint.findUnique({ where: { id: resource.resourceId }, select: { id: true, organizationId: true, status: true, version: true } });
    if (!complaint || complaint.organizationId !== actor.organizationId) workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, complaint.organizationId, action === 'read' ? 'customer-quality:complaints:read' : 'customer-quality:complaints:write');
    await tx.$queryRaw`SELECT id FROM customer_quality_complaints WHERE id = ${complaint.id}::uuid FOR UPDATE`;
    const current = await tx.customerQualityComplaint.findUniqueOrThrow({ where: { id: complaint.id }, select: { version: true, status: true, organizationId: true } });
    if (action !== 'read' && ['CLOSED', 'ARCHIVED'].includes(current.status)) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: current.organizationId, version: current.version };
  }
}
