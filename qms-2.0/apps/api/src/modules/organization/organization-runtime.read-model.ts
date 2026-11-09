import { Prisma, type Organization } from '../../generated/prisma/client.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';

export type OrganizationRuntime = Pick<Organization, 'id' | 'type' | 'status' | 'deletedAt' | 'configurationRequired'>;

export async function readOrganizationRuntime(transaction: AdminTransaction, organizationId: string, lock = false): Promise<OrganizationRuntime | null> {
  const [organization] = await transaction.$queryRaw<OrganizationRuntime[]>(Prisma.sql`
    SELECT id, type, status, deleted_at AS "deletedAt", configuration_required AS "configurationRequired"
    FROM organizations WHERE id = ${organizationId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  return organization ?? null;
}
