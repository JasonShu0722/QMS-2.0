import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationExpected, IntegrationMasterDataAdapter, IntegrationRecord } from '../../common/integration-master-data.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { supplierProfileInput } from './supplier-profile-input.js';

type SupplierRow = { id: string; version: number; code: string; name: string; contactName: string | null; contactEmail: string | null };
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function record({ id, version, code, name, contactName, contactEmail }: SupplierRow): IntegrationRecord {
  return { id, version, values: { code, name, ...(contactName ? { contactName } : {}), ...(contactEmail ? { contactEmail } : {}) } };
}

@Injectable()
export class SupplierProfileIngestionAdapter implements IntegrationMasterDataAdapter {
  constructor(private readonly audit: AuditLogService) {}

  private async input(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await assertAdminAccess(transaction, actor, organizationId, 'supplier-quality:profiles:write');
    const organization = await transaction.organization.findUnique({ where: { id: organizationId }, select: { type: true, status: true } });
    if (organization?.type !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    if (organization.status !== 'ACTIVE') fail('ORGANIZATION_DISABLED', 403);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['code', 'name', 'contactName', 'contactEmail'].includes(key))
      || Object.values(fields).some(value => typeof value === 'string' && /[\u0000\uD800-\uDFFF]/u.test(value))) fail('INTEGRATION_INPUT_INVALID', 400);
    let normalized: ReturnType<typeof supplierProfileInput>;
    try { normalized = supplierProfileInput({ businessCode: fields.code, displayName: fields.name, contactName: fields.contactName, contactEmail: fields.contactEmail }); }
    catch (error) {
      if (error instanceof HttpException && error.getStatus() === 400) fail('INTEGRATION_INPUT_INVALID', 400);
      throw error;
    }
    return { organizationId, code: normalized.businessCode, name: normalized.displayName, contactName: normalized.contactName, contactEmail: normalized.contactEmail };
  }

  private async find(transaction: AdminTransaction, organizationId: string, code: string, lock = false) {
    const [current] = await transaction.$queryRaw<SupplierRow[]>`SELECT id, version, business_code AS code, display_name AS name, contact_name AS "contactName", contact_email AS "contactEmail" FROM supplier_business_profiles WHERE owner_organization_id = ${organizationId}::uuid AND business_code = ${code} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return current;
  }

  async inspect(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields): Promise<IntegrationRecord | null> {
    const input = await this.input(transaction, actor, fields);
    const current = await this.find(transaction, input.organizationId, input.code);
    return current ? record(current) : null;
  }

  async write(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields, expected: IntegrationExpected, traceId: string): Promise<IntegrationRecord> {
    const input = await this.input(transaction, actor, fields);
    const { organizationId, code, name } = input;
    const current = await this.find(transaction, organizationId, code, true);
    if (expected === null ? !!current : !current || current.id !== expected.id || current.version !== expected.version) fail('CONCURRENCY_CONFLICT', 409);
    const contactName = input.contactName ?? current?.contactName ?? null;
    const contactEmail = input.contactEmail ?? current?.contactEmail ?? null;
    if (current?.name === name && current.contactName === contactName && current.contactEmail === contactEmail) return record(current);
    const id = current?.id ?? randomUUID();
    const [updated] = current
      ? await transaction.$queryRaw<SupplierRow[]>`UPDATE supplier_business_profiles SET display_name = ${name}, contact_name = ${contactName}, contact_email = ${contactEmail}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid AND version = ${current.version} RETURNING id, version, business_code AS code, display_name AS name, contact_name AS "contactName", contact_email AS "contactEmail"`
      : await transaction.$queryRaw<SupplierRow[]>`INSERT INTO supplier_business_profiles (id, owner_organization_id, business_code, display_name, contact_name, contact_email, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, ${contactName}, ${contactEmail}, CURRENT_TIMESTAMP) ON CONFLICT (owner_organization_id, business_code) DO NOTHING RETURNING id, version, business_code AS code, display_name AS name, contact_name AS "contactName", contact_email AS "contactEmail"`;
    if (!updated) fail('CONCURRENCY_CONFLICT', 409);
    await this.audit.record({ actorUserId: actor.id, organizationId, action: current ? 'SUPPLIER_PROFILE_UPDATED' : 'SUPPLIER_PROFILE_CREATED', resourceType: 'SupplierBusinessProfile', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: updated.version } }, transaction);
    return record(updated);
  }
}
