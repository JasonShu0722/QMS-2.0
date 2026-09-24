import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma, type Prisma as PrismaType } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

@Injectable()
export class NewProductFileResourceAdapter implements OnModuleInit {
  constructor(private readonly resources: FileResourceAccess) {}

  onModuleInit(): void {
    for (const resourceType of ['new-product-deliverable', 'new-product-lesson-check']) {
      this.resources.register({ resourceType, authorizeAndLock: (tx, actor, resource, action) => this.authorizeAndLock(tx, actor, resource, action) });
    }
  }

  private async authorizeAndLock(tx: PrismaType.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (!isUUID(resource.resourceId) || !['new-product-deliverable', 'new-product-lesson-check'].includes(resource.resourceType)) workflowError('FILE_RESOURCE_DENIED', 403);
    const record = resource.resourceType === 'new-product-deliverable'
      ? await tx.$queryRaw<{ organization_id: string; version: number; status: string }[]>(Prisma.sql`SELECT deliverable.organization_id, deliverable.version, stage.status FROM new_product_deliverables deliverable JOIN new_product_stages stage ON stage.id = deliverable.stage_id AND stage.organization_id = deliverable.organization_id WHERE deliverable.id = ${resource.resourceId}::uuid FOR UPDATE OF deliverable, stage`)
      : await tx.$queryRaw<{ organization_id: string; version: number; status: string }[]>(Prisma.sql`SELECT lesson_check.organization_id, lesson_check.version, project.status FROM new_product_lesson_checks lesson_check JOIN new_product_projects project ON project.id = lesson_check.project_id AND project.organization_id = lesson_check.organization_id WHERE lesson_check.id = ${resource.resourceId}::uuid FOR UPDATE OF lesson_check, project`);
    const current = record[0];
    if (!current || actor.accountType !== 'INTERNAL' || actor.organizationId !== current.organization_id) workflowError('FILE_RESOURCE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, current.organization_id, action === 'read' ? 'new-product-quality:projects:read' : 'new-product-quality:projects:write');
    if (action !== 'read' && current.status !== (resource.resourceType === 'new-product-deliverable' ? 'OPEN' : 'ACTIVE')) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: current.organization_id, version: current.version };
  }
}
