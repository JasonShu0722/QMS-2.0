import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { ProcessOperationSector } from './process-defect-completion.service.js';

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000\uD800-\uDFFF]/u.test(value)) fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
  return value.trim();
}

@Injectable()
export class ProcessOperationSectorService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private scope(actor: AdminActor) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async list(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:configuration:read');
      return tx.$queryRaw<ProcessOperationSector[]>`SELECT id, organization_id AS "organizationId", operation_name AS "operationName",
        sector_name AS "sectorName", active, version FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid ORDER BY operation_name, id`;
    });
  }

  async create(actor: AdminActor, input: { operationName: string; sectorName: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor), operationName = name(input.operationName), sectorName = name(input.sectorName);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_CREATED', permission: 'process-quality:configuration:manage', payload: { operationName, sectorName }, authentication: 'active' }, async tx => {
      const id = randomUUID();
      const inserted = await tx.$executeRaw`INSERT INTO process_operation_sectors (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${operationName}, ${sectorName}, ${actor.id}::uuid, ${actor.id}::uuid)
        ON CONFLICT (organization_id, operation_name) DO NOTHING`;
      if (inserted !== 1) fail('PROCESS_OPERATION_SECTOR_NAME_CONFLICT', 409);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'PROCESS_OPERATION_SECTOR_CREATED', resourceType: 'ProcessOperationSector', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1, structureName: operationName } }, tx);
      return this.find(tx, organizationId, id);
    });
  }

  async update(actor: AdminActor, id: string, input: { expectedVersion: number; operationName: string; sectorName: string; active: boolean }, traceId: string, key?: string) {
    const organizationId = this.scope(actor), operationName = name(input.operationName), sectorName = name(input.sectorName);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.active !== 'boolean') fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_UPDATED', permission: 'process-quality:configuration:manage', payload: { id, ...input, operationName, sectorName }, authentication: 'active' }, async tx => {
      await tx.$queryRaw`SELECT id FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid ORDER BY id FOR UPDATE`;
      const conflicting = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid AND operation_name = ${operationName} AND id <> ${id}::uuid`;
      if (conflicting.length) fail('PROCESS_OPERATION_SECTOR_NAME_CONFLICT', 409);
      const changed = await tx.$executeRaw`UPDATE process_operation_sectors SET operation_name = ${operationName}, sector_name = ${sectorName}, active = ${input.active},
        version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${input.expectedVersion}`;
      if (changed !== 1) fail('CONCURRENCY_CONFLICT', 409);
      const record = await this.find(tx, organizationId, id);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'PROCESS_OPERATION_SECTOR_UPDATED', resourceType: 'ProcessOperationSector', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, structureName: operationName } }, tx);
      return record;
    });
  }

  async remove(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_DELETED', permission: 'process-quality:configuration:manage', payload: { id, expectedVersion }, authentication: 'active' }, async tx => {
      const changed = await tx.$executeRaw`DELETE FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${expectedVersion}`;
      if (changed !== 1) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'PROCESS_OPERATION_SECTOR_DELETED', resourceType: 'ProcessOperationSector', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { resourceVersion: expectedVersion } }, tx);
      return { id };
    });
  }

  private async find(tx: AdminTransaction, organizationId: string, id: string) {
    const [row] = await tx.$queryRaw<ProcessOperationSector[]>`SELECT id, organization_id AS "organizationId", operation_name AS "operationName",
      sector_name AS "sectorName", active, version FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`;
    if (!row) fail('PROCESS_OPERATION_SECTOR_NOT_FOUND', 404);
    return row;
  }
}
