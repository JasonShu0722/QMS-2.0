import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { supplierProfileInput } from './supplier-profile-input.js';
import type { SupplierProfileImportDto, SupplierProfileImportResultDto, SupplierProfileImportResultRowDto } from './supplier-profile-import.dto.js';

@Injectable()
export class SupplierProfileImportService {
  constructor(private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly organizations: OrganizationService) {}

  async import(actor: AdminActor, input: SupplierProfileImportDto, traceId: string, key?: string): Promise<SupplierProfileImportResultDto> {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (input.organizationId && input.organizationId !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    if (Array.isArray(input.rows) && input.rows.length > 100) adminError('SUPPLIER_INPUT_INVALID', 413);
    if (!Array.isArray(input.rows) || !input.rows.length
      || input.rows.some((row) => !row || !Number.isSafeInteger(row.rowNumber) || row.rowNumber < 2 || row.rowNumber > 1000000)
      || new Set(input.rows.map((row) => row.rowNumber)).size !== input.rows.length) adminError('SUPPLIER_INPUT_INVALID', 400);
    const authorize = async (tx: AdminTransaction) => {
      await assertRecentAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'supplier-quality:profiles:write');
      if ((await this.organizations.lookup(organizationId, tx))?.type !== 'INTERNAL') adminError('SUPPLIER_INPUT_INVALID', 400);
    };
    // Reserve the whole request before independently committing its ordered rows.
    await this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PROFILE_IMPORT_STARTED', payload: input, permission: 'supplier-quality:profiles:write', isolationLevel: 'ReadCommitted' }, async () => ({ accepted: true }), authorize);
    const items: SupplierProfileImportResultRowDto[] = [];
    for (const row of [...input.rows].sort((first, second) => first.rowNumber - second.rowNumber)) {
      const rowKey = `supplier-import:${createHash('sha256').update(`${key}:${row.rowNumber}`).digest('hex')}`;
      const code = typeof row.businessCode === 'string' ? row.businessCode.trim().slice(0, 100) : '';
      const mutation = { actor, organizationId, key: rowKey, traceId, action: 'SUPPLIER_PROFILE_IMPORT_ROW', payload: row, permission: 'supplier-quality:profiles:write', duplicateCode: 'SUPPLIER_PROFILE_DUPLICATE' as const, isolationLevel: 'ReadCommitted' as const };
      try {
        items.push(await this.mutations.run(mutation, async (tx): Promise<SupplierProfileImportResultRowDto> => {
          let data: ReturnType<typeof supplierProfileInput>;
          try { data = supplierProfileInput(row); } catch (error) {
            if (error instanceof HttpException && error.getStatus() === 400) return { rowNumber: row.rowNumber, code, status: 'FAILED', errorCode: 'MASTER_DATA_INPUT_INVALID' };
            throw error;
          }
          const existing = await tx.supplierBusinessProfile.findUnique({ where: { ownerOrganizationId_businessCode: { ownerOrganizationId: organizationId, businessCode: data.businessCode } }, select: { id: true } });
          if (existing) return { rowNumber: row.rowNumber, code, status: 'SKIPPED_DUPLICATE', profileId: existing.id };
          const [profile] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO supplier_business_profiles (id, owner_organization_id, business_code, display_name, contact_name, contact_email, updated_at)
            VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${data.businessCode}, ${data.displayName}, ${data.contactName}, ${data.contactEmail}, CURRENT_TIMESTAMP)
            ON CONFLICT (owner_organization_id, business_code) DO NOTHING RETURNING id`;
          if (!profile) {
            const duplicate = await tx.supplierBusinessProfile.findUniqueOrThrow({ where: { ownerOrganizationId_businessCode: { ownerOrganizationId: organizationId, businessCode: data.businessCode } }, select: { id: true } });
            return { rowNumber: row.rowNumber, code, status: 'SKIPPED_DUPLICATE', profileId: duplicate.id };
          }
          await this.audit.record({ actorUserId: actor.id, organizationId, action: 'SUPPLIER_PROFILE_CREATED', resourceType: 'SupplierBusinessProfile', resourceId: profile.id, outcome: 'SUCCESS', traceId, metadata: { rowNumber: row.rowNumber } }, tx);
          return { rowNumber: row.rowNumber, code, status: 'CREATED', profileId: profile.id };
        }));
      } catch (error) {
        if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw error;
        const duplicate = error instanceof HttpException && (error.getResponse() as { code?: string }).code === 'SUPPLIER_PROFILE_DUPLICATE';
        items.push(await this.mutations.run(mutation, async (tx): Promise<SupplierProfileImportResultRowDto> => {
          await authorize(tx);
          const existing = duplicate && typeof row.businessCode === 'string' ? await tx.supplierBusinessProfile.findUnique({ where: { ownerOrganizationId_businessCode: { ownerOrganizationId: organizationId, businessCode: row.businessCode.trim() } }, select: { id: true } }) : null;
          return existing ? { rowNumber: row.rowNumber, code, status: 'SKIPPED_DUPLICATE', profileId: existing.id } : { rowNumber: row.rowNumber, code, status: 'FAILED', errorCode: 'MASTER_DATA_IMPORT_FAILED' };
        }));
      }
    }
    return { items, created: items.filter(({ status }) => status === 'CREATED').length, skipped: items.filter(({ status }) => status === 'SKIPPED_DUPLICATE').length, failed: items.filter(({ status }) => status === 'FAILED').length };
  }
}
