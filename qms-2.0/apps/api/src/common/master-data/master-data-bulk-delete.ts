import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor, AdminTransaction } from '../security/admin-mutation.service.js';
import type { AuditLogService } from '../../modules/audit-log/audit-log.service.js';
import { MasterDataBulkDeleteDto, type MasterDataBulkDeleteItemDto, type MasterDataBulkDeleteResultDto } from './master-data-bulk-delete.dto.js';

const tables = {
  supplier: { name: Prisma.sql`supplier_business_profiles`, scope: Prisma.sql`owner_organization_id`, resourceType: 'SupplierBusinessProfile', action: 'SUPPLIER_PROFILE_DELETED' },
  customer: { name: Prisma.sql`customer_quality_customers`, scope: Prisma.sql`organization_id`, resourceType: 'CustomerMaster', action: 'CUSTOMER_MASTER_DELETED' },
  material: { name: Prisma.sql`material_masters`, scope: Prisma.sql`organization_id`, resourceType: 'MaterialMaster', action: 'MATERIAL_MASTER_DELETED' },
  mapping: { name: Prisma.sql`component_project_mappings`, scope: Prisma.sql`organization_id`, resourceType: 'ComponentProjectMapping', action: 'COMPONENT_PROJECT_MAPPING_DELETED' },
};

export function validateMasterDataDeletion(input: MasterDataBulkDeleteDto) {
  const dto = plainToInstance(MasterDataBulkDeleteDto, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException();
  return dto;
}

export async function deleteSelectedMasterData(transaction: AdminTransaction, audit: AuditLogService, actor: AdminActor, organizationId: string,
  kind: keyof typeof tables, dto: MasterDataBulkDeleteDto, traceId: string,
  referenced?: (transaction: AdminTransaction, id: string) => Promise<boolean>): Promise<MasterDataBulkDeleteResultDto> {
  const table = tables[kind];
  const rows = await transaction.$queryRaw<{ id: string; version: number }[]>(Prisma.sql`SELECT id, version FROM ${table.name}
    WHERE ${table.scope} = ${organizationId}::uuid AND id = ANY(${dto.records.map(record => record.id)}::uuid[]) ORDER BY id FOR UPDATE`);
  const current = new Map(rows.map(row => [row.id, row]));
  const items: MasterDataBulkDeleteItemDto[] = [];
  for (const record of dto.records) {
    const row = current.get(record.id.toLowerCase());
    let status: MasterDataBulkDeleteItemDto['status'];
    if (!row) status = 'NOT_FOUND';
    else if (row.version !== record.expectedVersion) status = 'CONFLICT';
    else if (await referenced?.(transaction, row.id)) status = 'REFERENCED';
    else {
      await transaction.$executeRaw`SAVEPOINT master_data_delete_item`;
      try {
        const deleted = await transaction.$executeRaw(Prisma.sql`DELETE FROM ${table.name} WHERE id = ${row.id}::uuid AND ${table.scope} = ${organizationId}::uuid AND version = ${record.expectedVersion}`);
        status = deleted === 1 ? 'DELETED' : 'CONFLICT';
        await transaction.$executeRaw`RELEASE SAVEPOINT master_data_delete_item`;
      } catch (error) {
        await transaction.$executeRaw`ROLLBACK TO SAVEPOINT master_data_delete_item`;
        await transaction.$executeRaw`RELEASE SAVEPOINT master_data_delete_item`;
        const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
        const code = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
        if (failure.code !== 'P2003' && code !== '23503' && code !== '23001') throw error;
        status = 'REFERENCED';
      }
      if (status === 'DELETED') await audit.record({ organizationId, actorUserId: actor.id, action: table.action, resourceType: table.resourceType,
        resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: row.version } }, transaction);
    }
    items.push({ id: record.id, status });
  }
  return { items, deleted: items.filter(item => item.status === 'DELETED').length, referenced: items.filter(item => item.status === 'REFERENCED').length,
    conflicted: items.filter(item => item.status === 'CONFLICT').length, notFound: items.filter(item => item.status === 'NOT_FOUND').length };
}
