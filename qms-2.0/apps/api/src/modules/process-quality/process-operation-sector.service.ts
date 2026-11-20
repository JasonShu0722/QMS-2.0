import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ControlledValidationException } from '../../common/contracts/controlled-validation.exception.js';
import { PLATFORM_ERROR_MESSAGES } from '../../common/contracts/platform-error.js';
import type { IntegrationExpected, IntegrationRecord, OperationIntegrationFields } from '../../common/integration-master-data.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { readOrganizationRuntime, type OrganizationRuntime } from '../organization/organization-runtime.read-model.js';

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function rowError(code: 'PROCESS_OPERATION_SECTOR_INPUT_INVALID' | 'PROCESS_OPERATION_CODE_CONFLICT', path: string): never {
  throw new ControlledValidationException(code, [{ path, message: PLATFORM_ERROR_MESSAGES[code] }]);
}
function name(value: unknown, maximum = 200, path?: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed.length > maximum || /[\u0000\uD800-\uDFFF]/u.test(trimmed)) {
    if (path) rowError('PROCESS_OPERATION_SECTOR_INPUT_INVALID', path);
    fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
  }
  return trimmed;
}

type SectorInput = { operationCode?: string | null; operationName: string; sectorName?: string | null };
type OperationSector = { id: string; organizationId: string; operationCode: string | null; operationName: string; sectorName: string | null; active: boolean; version: number };
type CodedOperation = OperationSector & { operationCode: string };
const commonColumns = Prisma.sql`id, organization_id AS "organizationId", operation_name AS "operationName", sector_name AS "sectorName", active, version`;
const columns = Prisma.sql`${commonColumns}, operation_code AS "operationCode"`;
const legacyColumns = Prisma.sql`${commonColumns}, NULL::text AS "operationCode"`;
const integrationRecord = (row: CodedOperation): IntegrationRecord<OperationIntegrationFields> => ({ id: row.id, version: row.version, values: { operationCode: row.operationCode, operationName: row.operationName } });

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
      return tx.$queryRaw<OperationSector[]>`SELECT ${columns} FROM process_operation_master WHERE organization_id = ${organizationId}::uuid
        UNION ALL SELECT ${legacyColumns} FROM process_operation_sectors WHERE organization_id = ${organizationId}::uuid
        ORDER BY "operationName", "operationCode", id`;
    });
  }

  async create(actor: AdminActor, input: SectorInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor), operationName = name(input.operationName);
    const operationCode = input.operationCode == null ? null : name(input.operationCode, 100);
    const sectorName = input.sectorName == null ? null : name(input.sectorName);
    const record = await this.mutations.run<OperationSector>({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_CREATED', permission: 'process-quality:configuration:manage',
      payload: { ...(operationCode ? { operationCode } : {}), operationName, sectorName }, authentication: 'active' },
    async tx => {
      if (!operationCode) fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
      await this.requireActiveOrganization(tx, organizationId, true);
      return this.insert(tx, actor, organizationId, { operationCode, operationName, sectorName }, traceId);
    });
    return { ...record, operationCode: record.operationCode ?? null };
  }

  async bulkCreate(actor: AdminActor, items: readonly unknown[], traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const operations = items.map((item, index) => {
      const path = `items[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(field => field !== 'operationCode' && field !== 'operationName')) {
        rowError('PROCESS_OPERATION_SECTOR_INPUT_INVALID', path);
      }
      const fields = item as Partial<OperationIntegrationFields>;
      return { operationCode: name(fields.operationCode, 100, `${path}.operationCode`), operationName: name(fields.operationName, 200, `${path}.operationName`) };
    });
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTORS_BULK_CREATED', permission: 'process-quality:configuration:manage',
      payload: operations, authentication: 'active', isolationLevel: 'ReadCommitted' }, async tx => {
      const seen = new Set<string>();
      operations.forEach(({ operationCode }, index) => {
        if (seen.has(operationCode)) rowError('PROCESS_OPERATION_CODE_CONFLICT', `items[${index}].operationCode`);
        seen.add(operationCode);
      });
      const ordered = operations.map((operation, index) => ({ operation, index })).sort((first, second) =>
        first.operation.operationCode < second.operation.operationCode ? -1 : 1);
      const records: CodedOperation[] = [];
      for (const { operation, index } of ordered) {
        records[index] = await this.insert(tx, actor, organizationId, { ...operation, sectorName: null }, traceId, false, index);
      }
      return records;
    }, tx => this.requireActiveOrganization(tx, organizationId, true));
  }

  async update(actor: AdminActor, id: string, input: SectorInput & { expectedVersion: number; active: boolean }, traceId: string, key?: string) {
    const organizationId = this.scope(actor), operationName = name(input.operationName);
    const operationCode = input.operationCode == null ? input.operationCode : name(input.operationCode, 100);
    const sectorName = input.sectorName == null ? input.sectorName : name(input.sectorName);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.active !== 'boolean') fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
    try {
      const result = await this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_UPDATED', permission: 'process-quality:configuration:manage', payload: { id, ...input, operationCode, operationName, sectorName }, authentication: 'active' }, async tx => {
        await this.requireActiveOrganization(tx, organizationId, true);
        const identity = Prisma.sql`organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${input.expectedVersion}`;
        const [coded] = await tx.$queryRaw<CodedOperation[]>`SELECT ${columns} FROM process_operation_master WHERE ${identity} FOR UPDATE`;
        const current = coded ?? (await tx.$queryRaw<OperationSector[]>`SELECT ${legacyColumns} FROM process_operation_sectors WHERE ${identity} FOR UPDATE`)[0];
        if (!current) fail('CONCURRENCY_CONFLICT', 409);
        if (coded && operationCode !== undefined && operationCode !== coded.operationCode) fail('PROCESS_OPERATION_CODE_IMMUTABLE', 400);
        const nextSector = sectorName === undefined ? current.sectorName : sectorName;
        let record: OperationSector | undefined;
        if (!coded && operationCode) {
          [record] = await tx.$queryRaw<CodedOperation[]>`WITH legacy AS (
            DELETE FROM process_operation_sectors WHERE ${identity} RETURNING id, organization_id, version, created_by_id, created_at
          ) INSERT INTO process_operation_master (id, organization_id, operation_code, operation_name, sector_name, active, version, created_by_id, updated_by_id, created_at, manual_name_changed_at)
            SELECT id, organization_id, ${operationCode}, ${operationName}, ${nextSector}, ${input.active}, version + 1, created_by_id, ${actor.id}::uuid, created_at, clock_timestamp() FROM legacy
            RETURNING ${columns}`;
        } else {
          if (!coded && !nextSector) fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
          const table = coded ? Prisma.sql`process_operation_master` : Prisma.sql`process_operation_sectors`;
          const manualRename = coded && coded.operationName !== operationName ? Prisma.sql`, manual_name_changed_at = clock_timestamp()` : Prisma.empty;
          [record] = await tx.$queryRaw<OperationSector[]>`UPDATE ${table}
            SET operation_name = ${operationName}, sector_name = ${nextSector}, active = ${input.active},
              version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP ${manualRename}
            WHERE ${identity} RETURNING ${coded ? columns : legacyColumns}`;
        }
        if (!record) fail('CONCURRENCY_CONFLICT', 409);
        await this.auditChange(tx, actor, record, 'PROCESS_OPERATION_SECTOR_UPDATED', traceId);
        return record;
      });
      return { ...result, operationCode: result.operationCode ?? null };
    } catch (error) {
      const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      if ((failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode) === '23505') fail(operationCode ? 'PROCESS_OPERATION_CODE_CONFLICT' : 'PROCESS_OPERATION_SECTOR_NAME_CONFLICT', 409);
      throw error;
    }
  }

  async remove(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('PROCESS_OPERATION_SECTOR_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_OPERATION_SECTOR_DELETED', permission: 'process-quality:configuration:manage', payload: { id, expectedVersion }, authentication: 'active' }, async tx => {
      await this.requireActiveOrganization(tx, organizationId, true);
      const identity = Prisma.sql`organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${expectedVersion}`;
      const changed = await tx.$executeRaw`DELETE FROM process_operation_master WHERE ${identity}`
        || await tx.$executeRaw`DELETE FROM process_operation_sectors WHERE ${identity}`;
      if (changed !== 1) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ actorUserId: actor.id, organizationId, action: 'PROCESS_OPERATION_SECTOR_DELETED', resourceType: 'ProcessOperationSector', resourceId: id,
        outcome: 'SUCCESS', traceId, metadata: { resourceVersion: expectedVersion } }, tx);
      return { id };
    });
  }

  async inspectForIngestion(tx: AdminTransaction, actor: AdminActor, fields: OperationIntegrationFields, lock = false) {
    const organizationId = await this.ingestionScope(tx, actor);
    const operationCode = name(fields.operationCode, 100);
    const [row] = await tx.$queryRaw<Array<CodedOperation & { manualNameChangedAt: Date | null }>>`SELECT ${columns}, manual_name_changed_at AS "manualNameChangedAt" FROM process_operation_master
      WHERE organization_id = ${organizationId}::uuid AND operation_code = ${operationCode} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return row ? { ...integrationRecord(row), manualNameChangedAt: row.manualNameChangedAt } : null;
  }

  async writeForIngestion(tx: AdminTransaction, actor: AdminActor, fields: OperationIntegrationFields, expected: IntegrationExpected, traceId: string) {
    const organizationId = await this.ingestionScope(tx, actor);
    const operationCode = name(fields.operationCode, 100), operationName = name(fields.operationName);
    if (!expected) return integrationRecord(await this.insert(tx, actor, organizationId, { operationCode, operationName, sectorName: null }, traceId, true));
    const [record] = await tx.$queryRaw<CodedOperation[]>`UPDATE process_operation_master SET operation_name = ${operationName},
      version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${organizationId}::uuid AND id = ${expected.id}::uuid AND version = ${expected.version}
        AND operation_code = ${operationCode} RETURNING ${columns}`;
    if (!record) fail('CONCURRENCY_CONFLICT', 409);
    await this.auditChange(tx, actor, record, 'PROCESS_OPERATION_SECTOR_UPDATED', traceId, true);
    return integrationRecord(record);
  }

  private async ingestionScope(tx: AdminTransaction, actor: AdminActor) {
    const organizationId = this.scope(actor);
    await assertAdminAccess(tx, actor, organizationId, 'process-quality:configuration:manage');
    await this.requireActiveOrganization(tx, organizationId);
    return organizationId;
  }

  private async requireActiveOrganization(tx: AdminTransaction, organizationId: string, lock = false) {
    const organization = lock
      ? (await tx.$queryRaw<Omit<OrganizationRuntime, 'id'>[]>`SELECT type, status, deleted_at AS "deletedAt", configuration_required AS "configurationRequired"
          FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`)[0]
      : await readOrganizationRuntime(tx, organizationId);
    if (organization?.type !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired) fail('ORGANIZATION_DISABLED', 403);
  }

  private async insert(tx: AdminTransaction, actor: AdminActor, organizationId: string,
    fields: { operationCode: string; operationName: string; sectorName: string | null }, traceId: string, automatic = false, rowIndex?: number) {
    const [record] = await tx.$queryRaw<CodedOperation[]>`INSERT INTO process_operation_master
      (id, organization_id, operation_code, manual_name_changed_at, operation_name, sector_name, created_by_id, updated_by_id)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${fields.operationCode}, ${automatic ? Prisma.sql`NULL` : Prisma.sql`clock_timestamp()`}, ${fields.operationName}, ${fields.sectorName}, ${actor.id}::uuid, ${actor.id}::uuid)
      ON CONFLICT DO NOTHING RETURNING ${columns}`;
    if (!record) {
      if (rowIndex !== undefined) rowError('PROCESS_OPERATION_CODE_CONFLICT', `items[${rowIndex}].operationCode`);
      fail('PROCESS_OPERATION_CODE_CONFLICT', 409);
    }
    await this.auditChange(tx, actor, record, 'PROCESS_OPERATION_SECTOR_CREATED', traceId, automatic);
    return record;
  }

  private async auditChange(tx: AdminTransaction, actor: AdminActor, record: OperationSector, action: string, traceId: string, automatic = false) {
    await this.audit.record({ actorUserId: actor.id, organizationId: record.organizationId, action, resourceType: 'ProcessOperationSector', resourceId: record.id,
      outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, ...(automatic ? { target: 'OPERATION' } : { structureName: record.operationName }) } }, tx);
  }
}
