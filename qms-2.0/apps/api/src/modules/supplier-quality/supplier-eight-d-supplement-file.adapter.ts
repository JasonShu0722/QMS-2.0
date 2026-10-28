import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceRef } from '../file-management/file-resource-access.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierEightDSupplementFileAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-eight-d-supplement';
  constructor(private readonly resources: FileResourceAccess, private readonly reports: SupplierEightDService) {}
  onModuleInit() { this.resources.register(this); }
  authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction) {
    if (resource.resourceType !== this.resourceType) workflowError('FILE_RESOURCE_DENIED', 403);
    return this.reports.fileGrant(tx, actor, resource.resourceId, action, 'supplement');
  }
}
