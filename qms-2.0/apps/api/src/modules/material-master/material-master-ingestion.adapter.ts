import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationExpected, IntegrationMasterDataAdapter, IntegrationRecord } from '../../common/integration-master-data.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

type MaterialRow = { id: string; version: number; code: string; name: string };
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function record({ id, version, code, name }: MaterialRow): IntegrationRecord { return { id, version, values: { code, name } }; }

@Injectable()
export class MaterialMasterIngestionAdapter implements IntegrationMasterDataAdapter {
  constructor(private readonly audit: AuditLogService) {}

  private async input(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await assertAdminAccess(transaction, actor, organizationId, 'material-master:write');
    const organization = await transaction.organization.findUnique({ where: { id: organizationId }, select: { type: true, status: true } });
    if (organization?.type !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    if (organization.status !== 'ACTIVE') fail('ORGANIZATION_DISABLED', 403);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['code', 'name'].includes(key))
      || typeof fields.code !== 'string' || typeof fields.name !== 'string'
      || !fields.code.trim() || fields.code.trim().length > 100 || !fields.name.trim() || fields.name.trim().length > 200
      || [fields.code, fields.name].some(value => /[\u0000\uD800-\uDFFF]/u.test(value))) fail('INTEGRATION_INPUT_INVALID', 400);
    return { organizationId, code: fields.code.trim(), name: fields.name.trim() };
  }

  private async find(transaction: AdminTransaction, organizationId: string, code: string, lock = false) {
    const [current] = await transaction.$queryRaw<MaterialRow[]>`SELECT id, version, material_code AS code, material_name AS name FROM material_masters WHERE organization_id = ${organizationId}::uuid AND material_code = ${code} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return current;
  }

  async inspect(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields): Promise<IntegrationRecord | null> {
    const input = await this.input(transaction, actor, fields);
    const current = await this.find(transaction, input.organizationId, input.code);
    return current ? record(current) : null;
  }

  async write(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields, expected: IntegrationExpected, traceId: string): Promise<IntegrationRecord> {
    const { organizationId, code, name } = await this.input(transaction, actor, fields);
    const current = await this.find(transaction, organizationId, code, true);
    if (expected === null ? !!current : !current || current.id !== expected.id || current.version !== expected.version) fail('CONCURRENCY_CONFLICT', 409);
    if (current?.name === name) return record(current);
    const id = current?.id ?? randomUUID();
    const [updated] = current
      ? await transaction.$queryRaw<MaterialRow[]>`UPDATE material_masters SET material_name = ${name}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${current.version} RETURNING id, version, material_code AS code, material_name AS name`
      : await transaction.$queryRaw<MaterialRow[]>`INSERT INTO material_masters (id, organization_id, material_code, material_name, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) ON CONFLICT (organization_id, material_code) DO NOTHING RETURNING id, version, material_code AS code, material_name AS name`;
    if (!updated) fail('CONCURRENCY_CONFLICT', 409);
    await this.audit.record({ actorUserId: actor.id, organizationId, action: current ? 'MATERIAL_MASTER_UPDATED' : 'MATERIAL_MASTER_CREATED', resourceType: 'MaterialMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: updated.version } }, transaction);
    return record(updated);
  }
}
