import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceRef } from '../file-management/file-resource-access.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class SupplierEightDDisclosureFileAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'supplier-eight-d-disclosure';
  constructor(private readonly resources: FileResourceAccess, private readonly core: SupplierEightDService) {}
  onModuleInit() { this.resources.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction) {
    if (resource.resourceType !== this.resourceType) workflowError('FILE_RESOURCE_DENIED', 403);
    const grant = await this.core.disclosureFileGrant(tx, actor, resource.resourceId, action);
    if (actor.accountType !== 'SUPPLIER') return grant;
    const [publication] = await tx.$queryRaw<{ snapshot: Prisma.JsonValue }[]>`SELECT snapshot FROM supplier_eight_d_publications
      WHERE supplier_problem_id = ${resource.resourceId}::uuid AND target_supplier_organization_id = ${actor.organizationId}::uuid`;
    const snapshot = publication?.snapshot;
    const ids = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.selectedFileIds : undefined;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) workflowError('FILE_RESOURCE_DENIED', 403);
    return { ...grant, readableFileIds: ids as string[] };
  }
}
