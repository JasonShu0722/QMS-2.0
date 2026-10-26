import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceRef } from '../file-management/file-resource-access.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { ProcessEightDService } from './process-eight-d.service.js';

@Injectable()
export class ProcessEightDFileAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'process-eight-d';
  constructor(private readonly resources: FileResourceAccess, private readonly service: ProcessEightDService) {}
  onModuleInit(): void { this.resources.register(this); }
  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction) {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const reader = action === 'read' ? { ...actor, scopeOrganizationId: await this.service.readResourceOrganizationId(tx, resource.resourceId) } : actor;
    const record = await this.service.lockRecord(tx, reader, resource.resourceId, action === 'read' ? 'READ' : 'EDIT');
    if (action === 'read') await this.service.authorizeRead(tx, reader, record);
    else await this.service.authorizeEdit(tx, actor, record);
    // FileLifecycle checks this adapter before every delete: review and closed evidence stay protected.
    return { organizationId: record.problem.organizationId, version: record.report.version };
  }
}
