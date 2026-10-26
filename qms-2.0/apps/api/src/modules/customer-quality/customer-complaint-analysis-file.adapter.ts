import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceRef } from '../file-management/file-resource-access.js';
import { CustomerComplaintAnalysisService } from './customer-complaint-analysis.service.js';
import { ANALYSIS_RESOURCE_TYPE, analysisFail } from './customer-complaint-analysis.types.js';

@Injectable()
export class CustomerComplaintAnalysisFileAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = ANALYSIS_RESOURCE_TYPE;
  constructor(private readonly resources: FileResourceAccess, private readonly service: CustomerComplaintAnalysisService) {}
  onModuleInit(): void { this.resources.register(this); }
  authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction) {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) analysisFail('FILE_RESOURCE_DENIED', 403);
    return this.service.authorizeFile(tx, actor, resource.resourceId, action);
  }
}
