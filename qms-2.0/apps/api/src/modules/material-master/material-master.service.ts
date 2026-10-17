import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { MaterialMasterDto, MaterialMasterImportRowDto, MaterialMasterImportItemDto } from './material-master.dto.js';

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function text(value: unknown, max: number): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max) fail('MATERIAL_MASTER_INPUT_INVALID', 400);
  return result;
}

@Injectable()
export class MaterialMasterService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async assertInternalOrganization(tx: AdminTransaction, organizationId: string) {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (organization?.type !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
  }

  async listMaterials(actor: AdminActor): Promise<MaterialMasterDto[]> {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'material-master:read');
      await this.assertInternalOrganization(tx, organizationId);
      return tx.$queryRaw<MaterialMasterDto[]>`SELECT id, material_code AS "materialCode", material_name AS "materialName", version FROM material_masters WHERE organization_id = ${organizationId}::uuid ORDER BY material_code`;
    });
  }

  private async insert(tx: AdminTransaction, actor: AdminActor, input: { materialCode: unknown; materialName: unknown }, traceId: string, permission: string) {
    const organizationId = this.scope(actor);
    await assertAdminAccess(tx, actor, organizationId, permission);
    const materialCode = text(input.materialCode, 100); const materialName = text(input.materialName, 200);
    const id = randomUUID();
    const rows = await tx.$queryRaw<MaterialMasterDto[]>`INSERT INTO material_masters (id, organization_id, material_code, material_name, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${materialCode}, ${materialName}, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) ON CONFLICT (organization_id, material_code) DO NOTHING RETURNING id, material_code AS "materialCode", material_name AS "materialName", version`;
    if (!rows[0]) return null;
    await this.audit.record({ organizationId, actorUserId: actor.id, action: 'MATERIAL_MASTER_CREATED', resourceType: 'MaterialMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
    return rows[0];
  }

  async createMaterial(actor: AdminActor, input: { materialCode: string; materialName: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const payload = { materialCode: text(input.materialCode, 100), materialName: text(input.materialName, 200) };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'MATERIAL_MASTER_CREATED', payload, permission: 'material-master:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
      const material = await this.insert(tx, actor, payload, traceId, 'material-master:write');
      if (!material) fail('CONCURRENCY_CONFLICT', 409);
      return material;
    }, (tx) => this.assertInternalOrganization(tx, organizationId));
  }

  async updateMaterial(actor: AdminActor, id: string, input: { expectedVersion: number; materialName: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('MATERIAL_MASTER_INPUT_INVALID', 400);
    const materialName = text(input.materialName, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'MATERIAL_MASTER_UPDATED', payload: { id, materialName, expectedVersion: input.expectedVersion }, permission: 'material-master:write' }, async (tx) => {
      const rows = await tx.$queryRaw<MaterialMasterDto[]>`UPDATE material_masters SET material_name = ${materialName}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} RETURNING id, material_code AS "materialCode", material_name AS "materialName", version`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'MATERIAL_MASTER_UPDATED', resourceType: 'MaterialMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return rows[0];
    }, async (tx) => {
      await this.assertInternalOrganization(tx, organizationId);
      const current = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM material_masters WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!current[0]) fail('MATERIAL_MASTER_NOT_FOUND', 404);
    });
  }

  async importMaterials(actor: AdminActor, rows: MaterialMasterImportRowDto[], traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (Array.isArray(rows) && rows.length > 100) fail('MATERIAL_MASTER_INPUT_INVALID', 413);
    if (!Array.isArray(rows) || rows.length < 1 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || Object.keys(row).some((field) => !['rowNumber', 'materialCode', 'materialName'].includes(field))) || new Set(rows.map((row) => row.rowNumber)).size !== rows.length) fail('MATERIAL_MASTER_INPUT_INVALID', 400);
    // Reserve the batch payload before row commits; replay cannot change or append rows.
    await this.mutations.run({ actor, organizationId, key, traceId, action: 'MATERIAL_MASTER_IMPORT', payload: rows, permission: 'material-master:import', isolationLevel: 'ReadCommitted' }, async () => null, (tx) => this.assertInternalOrganization(tx, organizationId));
    const batchKey = createHash('sha256').update(key!).digest('hex');
    const items: MaterialMasterImportItemDto[] = [];
    for (const row of [...rows].sort((first, second) => first.rowNumber - second.rowNumber)) {
      const code = typeof row.materialCode === 'string' ? row.materialCode.trim() : '';
      try {
        const result = await this.mutations.run({ actor, organizationId, key: `material-import:${batchKey}:${row.rowNumber}`, traceId, action: 'MATERIAL_MASTER_IMPORT_ROW', payload: row, permission: 'material-master:import', isolationLevel: 'ReadCommitted' }, async (tx) => {
          const material = await this.insert(tx, actor, row, traceId, 'material-master:import');
          return { rowNumber: row.rowNumber, code, status: material ? 'CREATED' as const : 'SKIPPED_DUPLICATE' as const };
        }, (tx) => this.assertInternalOrganization(tx, organizationId));
        items.push(result);
      } catch (error) {
        const errorCode = error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
        if (error instanceof HttpException && ([401, 403].includes(error.getStatus()) || errorCode === 'IDEMPOTENCY_REPLAY')) throw error;
        items.push({ rowNumber: row.rowNumber, code, status: 'FAILED', errorCode: errorCode ?? 'MATERIAL_MASTER_IMPORT_ROW_FAILED' });
      }
    }
    return { items, created: items.filter((item) => item.status === 'CREATED').length, skipped: items.filter((item) => item.status === 'SKIPPED_DUPLICATE').length, failed: items.filter((item) => item.status === 'FAILED').length };
  }
}
