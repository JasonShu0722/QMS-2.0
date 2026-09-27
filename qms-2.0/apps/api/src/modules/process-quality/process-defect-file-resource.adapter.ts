import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class ProcessDefectFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'process-defect';

  constructor(private readonly resources: FileResourceAccess) {}

  onModuleInit(): void { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const record = await tx.processDefect.findUnique({ where: { id: resource.resourceId }, select: { id: true, organizationId: true, archivedAt: true } });
    if (!record || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, record.organizationId, action === 'read' ? 'process-quality:defects:read' : 'process-quality:defects:write');
    await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${record.id}::uuid FOR UPDATE`;
    const current = await tx.processDefect.findUniqueOrThrow({ where: { id: record.id }, select: { version: true, archivedAt: true } });
    if (action !== 'read' && current.archivedAt) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.organizationId, version: current.version };
  }
}
