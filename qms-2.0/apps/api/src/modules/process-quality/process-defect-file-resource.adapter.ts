import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceAction, type FileResourceChange, type FileResourceGrant, type FileResourceRef } from '../file-management/file-resource-access.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { recordProcessDefectUpdate } from './process-defect-update-records.js';

@Injectable()
export class ProcessDefectFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'process-defect';

  constructor(private readonly resources: FileResourceAccess, private readonly audit: AuditLogService) {}

  onModuleInit(): void { this.resources.register(this); }

  recordChange(tx: Prisma.TransactionClient, change: FileResourceChange) {
    const { resource, organizationId, actorUserId, action, traceId } = change;
    return recordProcessDefectUpdate(this.audit, tx, { organizationId, actorUserId, resourceId: resource.resourceId, traceId }, [action === 'added' ? 'attachmentAdded' : 'attachmentRemoved']);
  }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction): Promise<FileResourceGrant> {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const record = await tx.processDefect.findUnique({ where: { id: resource.resourceId }, select: { id: true, organizationId: true, archivedAt: true } });
    if (!record || actor.accountType !== 'INTERNAL') workflowError('FILE_RESOURCE_DENIED', 403);
    await assertActiveAuthentication(tx, actor);
    await assertWorkflowFeature(tx, actor, record.organizationId, action === 'read' ? 'process-quality:defects:read' : 'process-quality:defects:write');
    await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${record.id}::uuid FOR UPDATE`;
    const current = await tx.processDefect.findUniqueOrThrow({ where: { id: record.id }, select: { version: true, archivedAt: true } });
    if (action !== 'read' && current.archivedAt) workflowError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: record.organizationId, version: current.version };
  }
}
